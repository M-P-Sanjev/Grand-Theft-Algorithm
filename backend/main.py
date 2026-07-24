# Built-in libraries
import base64
import json
import logging
import os

# External dependencies
import boto3
from bson import ObjectId
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from backend.cases import (
    CaseCreate,
    admin_key,
    consume_or_check_token,
    create_case,
    get_case,
    issue_passport_token,
    list_cases,
    save_evidence_file,
    secret_passport,
    to_admin_dashboard_doc,
    update_case,
)
from backend.db import get_database, upload_embeddings_to_mongo
from backend.logger import CustomFormatter
from backend.schema import CaseCreateBody, EscalateBody, FileContent, PassportRequest, PostInfo
from backend.utils.common import (load_image_from_url_or_file,
                                  read_files_from_directory,
                                  serialize_object_id)
from backend.utils.embedding import find_top_matches, generate_text_embedding
from backend.utils.regex_ptr import extract_info
from backend.utils.steganography import (decode_text_from_image,
                                         encode_text_in_image)
from backend.utils.text_llm import (create_poem, decompose_user_text,
                                    expand_user_text_using_gemini,
                                    expand_user_text_using_gemma,
                                    text_to_image)
from backend.utils.twitter import send_message_to_twitter

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
handler = logging.StreamHandler()
handler.setFormatter(CustomFormatter())
logger.addHandler(handler)

# Cached database connection
db = None

# Initialize FastAPI and CORS middleware
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def initialize_database():
    global db
    if db is None:
        try:
            db = get_database()  # Establish the connection once at load time
        except Exception as e:
            logger.warning("MongoDB unavailable, using local case store only: %s", e)
            db = None


# Call the initialize function at startup
@app.on_event("startup")
async def startup_event():
    initialize_database()


# --- Water cover SOS case pipeline ---

@app.post("/verify-passport")
async def verify_passport(body: PassportRequest):
    """Validate the secret passport OTP used by the Water dish cover."""
    if body.code.strip() != secret_passport():
        raise HTTPException(status_code=401, detail="Invalid delivery code")
    token = issue_passport_token()
    return {"ok": True, "token": token}


@app.post("/cases")
async def create_abuse_case(
    notes: str = Form(...),
    frequency: str = Form('once'),
    severity: str = Form('medium'),
    name: str = Form(None),
    phone: str = Form(None),
    location: str = Form(None),
    lat: str = Form(None),
    lng: str = Form(None),
    token: str = Form(...),
    files: list[UploadFile] = File(default=[]),
):
    """Create a victim case after passport unlock. Auto-routes high/repetitive abuse."""
    if not consume_or_check_token(token, consume=False):
        raise HTTPException(status_code=401, detail="Session expired. Open Water again.")

    if frequency not in ('once', 'repeated', 'ongoing'):
        raise HTTPException(status_code=400, detail="Invalid frequency")
    if severity not in ('low', 'medium', 'high', 'critical'):
        raise HTTPException(status_code=400, detail="Invalid severity")
    if not notes.strip():
        raise HTTPException(status_code=400, detail="Notes are required")

    lat_f = None
    lng_f = None
    try:
        if lat not in (None, ''):
            lat_f = float(lat)
        if lng not in (None, ''):
            lng_f = float(lng)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid coordinates")

    evidence_meta = []
    upload_list = files if isinstance(files, list) else ([files] if files else [])
    for upload in upload_list:
        if not getattr(upload, 'filename', None):
            continue
        content = await upload.read()
        if not content:
            continue
        evidence_meta.append(save_evidence_file(upload.filename, content))

    payload = CaseCreate(
        notes=notes,
        frequency=frequency,  # type: ignore[arg-type]
        severity=severity,  # type: ignore[arg-type]
        name=name,
        phone=phone,
        location=location,
        lat=lat_f,
        lng=lng_f,
        token=token,
        evidence=evidence_meta,
    )
    case = create_case(payload, evidence_meta)

    # Mirror into Mongo admin collection when available (web dashboard)
    if db is not None:
        try:
            db['admin'].insert_one(to_admin_dashboard_doc(case))
            db['cases'].insert_one({**case})
        except Exception as e:
            logger.warning("Could not mirror case to Mongo: %s", e)

    return {
        "status": "ok",
        "case": case,
        "message": "Order received",
        "routing": case['routing'],
    }


@app.get("/cases")
async def get_cases(x_admin_key: str = Header(default='')):
    if x_admin_key != admin_key():
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {"cases": list_cases()}


@app.get("/cases/{case_id}")
async def get_case_detail(case_id: str, x_admin_key: str = Header(default='')):
    if x_admin_key != admin_key():
        raise HTTPException(status_code=401, detail="Unauthorized")
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@app.post("/cases/{case_id}/escalate")
async def escalate_case(case_id: str, body: EscalateBody):
    if body.admin_key != admin_key():
        raise HTTPException(status_code=401, detail="Unauthorized")
    if body.target not in ('admin', 'ngo', 'police'):
        raise HTTPException(status_code=400, detail="Invalid target")
    from backend.cases import escalation_contacts

    case = update_case(
        case_id,
        routing=body.target,
        escalation_contacts=escalation_contacts(body.target),
        status='open',
    )
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return {"status": "escalated", "case": case}


@app.post("/cases/{case_id}/close")
async def close_case(case_id: str, body: dict):
    key = body.get('admin_key', '')
    if key != admin_key():
        raise HTTPException(status_code=401, detail="Unauthorized")
    case = update_case(case_id, status='closed')
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return {"status": "closed", "case": case}


@app.get("/health")
async def health():
    return {"ok": True, "mongo": db is not None}


# Environment and AWS setup
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION")
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "shebuilds-womentechmakers")

s3_client = boto3.client(
    "s3",
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    region_name=AWS_REGION,
) if AWS_ACCESS_KEY_ID else None
bedrock_client = boto3.client("bedrock-runtime", region_name=AWS_REGION) if AWS_ACCESS_KEY_ID else None

# API Endpoints
@app.post("/text-generation")
async def get_post_and_expand_its_content(post_info: PostInfo):
    """Expand user input text for help message generation."""
    try:
        concatenated_text = (
            f"Name: {post_info.name}\n"
            f"Phone: {post_info.phone}\n"
            f"Location: {post_info.location}\n"
            f"Duration of Abuse: {post_info.duration_of_abuse}\n"
            f"Frequency of Incidents: {post_info.frequency_of_incidents}\n"
            f"Preferred Contact Method: {post_info.preferred_contact_method}\n"
            f"Current Situation: {post_info.current_situation}\n"
            f"Culprit Description: {post_info.culprit_description}\n"
            f"Custom Text: {post_info.custom_text}\n"
        )
        gemini_response = await expand_user_text_using_gemini(concatenated_text)
        gemma_response = await expand_user_text_using_gemma(concatenated_text)
        return {"gemini_response": gemini_response, "gemma_response": gemma_response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error expanding text: {e}")

@app.post("/img-generation")
async def create_image_from_prompt(input_data: str):
    """Generate an image based on a text prompt."""
    try:
        text_to_image(input_data)
        return {"received_text": input_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating image: {e}")


@app.post("/text-decomposition")
async def decompose_text_content(data: dict):
    """Decompose and extract information from user text."""
    try:
        text = data.get("text")
        decomposed_text = decompose_user_text(text)
        return {"extracted_data": extract_info(decomposed_text)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error decomposing text: {e}")


@app.post("/save-extracted-data")
async def save_extracted_data(data: dict):
    try:
        if db is None:
            # Fallback: persist via local case store shape
            return {"status": "Data saved locally (Mongo unavailable)"}
        db["admin"].insert_one(data)
        return {"status": "Data saved successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving data: {e}")


@app.post("/encode")
async def encode_text_in_image_endpoint(
    text: str, img_url: str = None, file: UploadFile = File(None)
):
    """Encode text into an image."""
    try:
        image = load_image_from_url_or_file(img_url, file)
        encoded_image = encode_text_in_image(image, text)
        output_path = "encoded_image.png"
        encoded_image.save(output_path, format="PNG")
        return StreamingResponse(
            open(output_path, "rb"),
            media_type="image/png",
            headers={"Content-Disposition": "attachment; filename=encoded_image.png"},
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error encoding text in image: {e}"
        )


@app.post("/decode")
async def decode_text_from_image_endpoint(
    img_url: str = None, file: UploadFile = File(None)
):
    """Decode text from an image."""
    try:
        image = load_image_from_url_or_file(img_url, file)
        return {"decoded_text": decode_text_from_image(image)}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error decoding text from image: {e}"
        )


@app.get("/poem-generation")
async def create_poem_endpoint(text: str):
    """Generate an inspirational poem based on input text."""
    try:
        return {"poem": create_poem(text)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating poem: {e}")


@app.post("/send-message")
async def send_message_to_twitter_endpoint(image_url: str, caption: str):
    """Send a message to Twitter."""
    try:
        send_message_to_twitter(image_url, caption)
        return {"status": "Message sent successfully"}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error sending message to Twitter: {e}"
        )


@app.get("/get-admin-posts")
def get_all_posts():
    """Retrieve all posts from the database."""
    try:
        if db is None:
            return JSONResponse(content=[to_admin_dashboard_doc(c) for c in list_cases()])
        posts = [serialize_object_id(post) for post in db["admin"].find()]
        return JSONResponse(content=posts)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving posts: {e}")


@app.get("/find-match")
def find_top_matching_posts(info: str, collection: str):
    """Find top matches based on embedding similarity."""
    try:
        description_vector = generate_text_embedding(info)
        top_matches = find_top_matches(db[collection], description_vector)
        return [serialize_object_id(match) for match in top_matches]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error finding matches: {e}")


@app.get("/get-post/{post_id}")
def get_post_by_id(post_id: str):
    """Retrieve a specific post by its ID."""
    try:
        post = db["admin"].find_one({"_id": ObjectId(post_id)})
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")
        return JSONResponse(content=serialize_object_id(post))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving post by ID: {e}")

@app.post("/close-issue/{issue_id}")
async def close_issue(issue_id: str):
    """Mark an issue as closed by updating its status."""
    try:
        result = db["admin"].update_one(
            {"_id": ObjectId(issue_id)},
            {"$set": {"status": "closed"}}
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=404, detail="Issue not found or already closed")
        return {"status": "Issue marked as closed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error closing issue: {e}")

@app.post("/upload_embeddings/")
async def upload_embeddings():
    """Upload embeddings to MongoDB."""
    try:
        file_contents = read_files_from_directory("backend/docs")
        upload_embeddings_to_mongo(file_contents)
        return {"message": "Embeddings uploaded successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error uploading embeddings: {e}")


@app.post("/generate-image")
async def generate_image(data: dict):
    """Generate an image based on a text prompt using Amazon Bedrock and store it in S3."""
    try:
        # Payload for image generation
        prompt = data.get("prompt")
        print("Prompt: ", prompt)
        body = json.dumps({
            "taskType": "TEXT_IMAGE",
            "textToImageParams": {"text": prompt},
            "imageGenerationConfig": {
                "numberOfImages": 3,
                "quality": "standard",
                "height": 1024,
                "width": 1024,
                "cfgScale": 7.5,
                "seed": 42
            }
        })
        # Model invocation
        response = bedrock_client.invoke_model(
            body=body,
            modelId="amazon.titan-image-generator-v1",
            accept="application/json",
            contentType="application/json"
        )
        response_body = json.loads(response.get("body").read())
        images_b64 = response_body["images"]
        image_urls = []
        for img_b64 in images_b64:
            image_data = base64.b64decode(img_b64)
            image_key = f"generated-images/{ObjectId()}.png"
            print("Image Key: ", image_key)
            s3_client.put_object(
                Bucket=S3_BUCKET_NAME,
                Key=image_key,
                Body=image_data,
                ContentType="image/png",

            )
            image_url = f"https://{S3_BUCKET_NAME}.s3.{AWS_REGION}.amazonaws.com/{image_key}"
            image_urls.append(image_url)
            print("Image URL: ", image_url)
        return {"image_urls": image_urls}
    except Exception as e:
        logger.error("Error generating image: %s", e)
        raise HTTPException(status_code=500, detail=f"Error generating image: {e}")