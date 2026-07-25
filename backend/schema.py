from typing import Literal, Optional

from pydantic import BaseModel, Field


class PostInfo(BaseModel):
    name: str
    phone: str
    location: object
    duration_of_abuse: str
    frequency_of_incidents: str
    preferred_contact_method: list[str]
    current_situation: str
    culprit_description: str
    custom_text: Optional[str] = None


# Pydantic model to validate input
class FileContent(BaseModel):
    filename: str
    content: str


class PassportRequest(BaseModel):
    code: str


class CaseCreateBody(BaseModel):
    notes: str
    frequency: Literal['once', 'repeated', 'ongoing'] = 'once'
    severity: Literal['low', 'medium', 'high', 'critical'] = 'medium'
    name: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    token: str
    evidence: list[dict[str, str]] = Field(default_factory=list)


class EscalateBody(BaseModel):
    target: Literal['admin', 'ngo', 'police']
    admin_key: str


class AdminKeyBody(BaseModel):
    admin_key: str


class AgentQuestionBody(BaseModel):
    question: str = ''
    admin_key: Optional[str] = None
    token: Optional[str] = None  # passport or secure channel token for survivors


class SecureMessageBody(BaseModel):
    admin_key: str
    message: str


class SecureReplyBody(BaseModel):
    message: str


class ChatStreamBody(BaseModel):
    question: str
    session_id: Optional[str] = None
    admin_key: Optional[str] = None
    token: Optional[str] = None


class LocationUpdateBody(BaseModel):
    token: Optional[str] = None
    admin_key: Optional[str] = None
    lat: float
    lng: float
    accuracy: Optional[float] = None
    live: bool = False


class GuardianActivateBody(BaseModel):
    token: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    location: Optional[str] = None
    stealth: bool = False
    recording: bool = True
    name: Optional[str] = None
    phone: Optional[str] = None


class GuardianTranscriptBody(BaseModel):
    token: str
    text: str
    final: bool = False
    t_sec: Optional[float] = None
    source: str = 'browser'


class GuardianEvidenceBody(BaseModel):
    token: str
    filename: str = 'guardian-audio.webm'
    content_b64: str
    encrypted: bool = False
    confirm_upload: bool = True
    kind: str = 'audio'
    duration_sec: Optional[float] = None


class GuardianAudioChunkBody(BaseModel):
    token: str
    content_b64: str
    seq: int = 0
    mime: str = 'audio/webm'
    t_sec: Optional[float] = None
    force_stt: bool = False
    stt: str = 'pending'


class GuardianEvidenceFinalizeBody(BaseModel):
    token: str
    content_b64: Optional[str] = None
    filename: str = 'guardian-audio.webm'
    duration_sec: Optional[float] = None
    confirm_upload: bool = True
    live_snapshot: bool = False


class GuardianContactNotifyBody(BaseModel):
    token: str
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    message: Optional[str] = None
