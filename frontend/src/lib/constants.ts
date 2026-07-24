export const SITE = {
  name: 'Safra',
  tagline: 'A curated kitchen. Delivered.',
  subheading: 'Twenty-two signature dishes — chosen with intention.',
} as const

export const NAV = [
  { label: 'Menu', href: '#menu' },
  { label: 'Cart', href: '#order' },
] as const

/** Premium category chips — curated, not endless. */
export const CATEGORIES = [
  { id: 'burgers', label: 'Burgers', emoji: '🍔' },
  { id: 'pizza', label: 'Pizza', emoji: '🍕' },
  { id: 'pasta', label: 'Pasta', emoji: '🍝' },
  { id: 'asian', label: 'Asian', emoji: '🍜' },
  { id: 'healthy', label: 'Healthy', emoji: '🥗' },
  { id: 'grills', label: 'Grills', emoji: '🥩' },
  { id: 'desserts', label: 'Desserts', emoji: '🍰' },
  { id: 'drinks', label: 'Drinks', emoji: '🥤' },
] as const

type CatId = (typeof CATEGORIES)[number]['id']

/** Shared crop so every card shares the same aspect / grade feel. */
const img = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&h=1500&q=85`

export type MenuItem = {
  id: string
  name: string
  category: CatId
  price: number
  rating: number
  time: number
  img: string
  desc: string
  secretEntry?: boolean
  chefPick?: boolean
  /** @deprecated kept optional for older cart state */
  calories?: number
}

/**
 * Curated signature menu — one unique photograph per dish.
 * Image subject matches the dish name. Never pad by reusing photos.
 */
export const SIGNATURE_MENU: MenuItem[] = [
  // 🍔 Burgers (3)
  {
    id: 'burger-wagyu',
    name: 'Truffle Wagyu Burger',
    category: 'burgers',
    price: 24,
    rating: 4.9,
    time: 22,
    chefPick: true,
    img: img('photo-1568901346375-23c9450c58cd'),
    desc: 'Wagyu patty, black truffle aioli, aged cheddar, brioche.',
  },
  {
    id: 'burger-smash',
    name: 'Double Smash Cheeseburger',
    category: 'burgers',
    price: 18,
    rating: 4.8,
    time: 18,
    img: img('photo-1550547660-d9450f859349'),
    desc: 'Two thin smash patties, American cheese, house pickles.',
  },
  {
    id: 'burger-chicken',
    name: 'Crispy Chicken Burger',
    category: 'burgers',
    price: 16,
    rating: 4.7,
    time: 20,
    img: img('photo-1606755962773-d324e0a13086'),
    desc: 'Buttermilk fried chicken, soft bun, herb mayo, slaw.',
  },

  // 🍕 Pizza (3)
  {
    id: 'pizza-margherita',
    name: 'Burrata Margherita Pizza',
    category: 'pizza',
    price: 21,
    rating: 4.9,
    time: 25,
    chefPick: true,
    img: img('photo-1574071318508-1cdbab80d002'),
    desc: 'San Marzano tomato, fresh basil, torn burrata.',
  },
  {
    id: 'pizza-pepperoni',
    name: 'Fire Pepperoni Pizza',
    category: 'pizza',
    price: 19,
    rating: 4.8,
    time: 24,
    img: img('photo-1628840042765-356cda07504e'),
    desc: 'Cupped pepperoni, mozzarella, chili honey finish.',
  },
  {
    id: 'pizza-mushroom',
    name: 'Wild Mushroom Pizza',
    category: 'pizza',
    price: 20,
    rating: 4.7,
    time: 26,
    img: img('photo-1513104890138-7c749659a591'),
    desc: 'Roasted forest mushrooms, garlic oil, thyme.',
  },

  // 🍝 Pasta (3)
  {
    id: 'pasta-alfredo',
    name: 'Creamy Alfredo Pasta',
    category: 'pasta',
    price: 19,
    rating: 4.8,
    time: 22,
    img: img('photo-1645112411341-6c4fd023714a'),
    desc: 'Fettuccine, Parmigiano cream, cracked pepper.',
  },
  {
    id: 'pasta-carbonara',
    name: 'Classic Carbonara',
    category: 'pasta',
    price: 20,
    rating: 4.9,
    time: 23,
    chefPick: true,
    img: img('photo-1612874742237-6526221588e3'),
    desc: 'Egg yolk emulsion, guanciale, pecorino.',
  },
  {
    id: 'pasta-pesto',
    name: 'Basil Pesto Linguine',
    category: 'pasta',
    price: 18,
    rating: 4.7,
    time: 21,
    img: img('photo-1473093295043-cdd812d0e601'),
    desc: 'Genovese basil pesto, pine nuts, lemon zest.',
  },

  // 🍜 Asian (3)
  {
    id: 'asian-ramen',
    name: 'Tonkotsu Ramen',
    category: 'asian',
    price: 17,
    rating: 4.9,
    time: 20,
    chefPick: true,
    img: img('photo-1569718212165-3a8278d5f624'),
    desc: '12-hour pork broth, chashu, soft egg, nori.',
  },
  {
    id: 'asian-nigiri',
    name: 'Salmon Nigiri Set',
    category: 'asian',
    price: 22,
    rating: 4.8,
    time: 18,
    img: img('photo-1579871494447-9811cf80d66c'),
    desc: 'Hand-pressed sushi rice, Norwegian salmon, wasabi.',
  },
  {
    id: 'asian-gyoza',
    name: 'Pan-Seared Gyoza',
    category: 'asian',
    price: 14,
    rating: 4.7,
    time: 16,
    img: img('photo-1496116218417-1a781b1c416c'),
    desc: 'Pork and cabbage dumplings, crisp skirt, ponzu.',
  },

  // 🥗 Healthy (2)
  {
    id: 'healthy-med',
    name: 'Mediterranean Salad',
    category: 'healthy',
    price: 15,
    rating: 4.8,
    time: 14,
    img: img('photo-1512621776951-a57141f2eefd'),
    desc: 'Tomato, cucumber, olives, feta, oregano oil.',
  },
  {
    id: 'healthy-bowl',
    name: 'Avocado Harvest Bowl',
    category: 'healthy',
    price: 16,
    rating: 4.7,
    time: 15,
    img: img('photo-1546069901-ba9599a7e63c'),
    desc: 'Avocado, grains, roasted veg, citrus dressing.',
  },

  // 🥩 Grills (3)
  {
    id: 'grill-ribeye',
    name: 'Angus Ribeye Steak',
    category: 'grills',
    price: 38,
    rating: 4.9,
    time: 28,
    chefPick: true,
    img: img('photo-1600891964092-4316c288032e'),
    desc: 'Dry-aged ribeye, bone marrow butter, sea salt.',
  },
  {
    id: 'grill-ribs',
    name: 'Smoked BBQ Ribs',
    category: 'grills',
    price: 32,
    rating: 4.8,
    time: 27,
    img: img('photo-1544025162-d76694265947'),
    desc: 'Slow-smoked ribs, sticky glaze, charred edge.',
  },
  {
    id: 'grill-chicken',
    name: 'Herb Roast Chicken',
    category: 'grills',
    price: 22,
    rating: 4.7,
    time: 25,
    img: img('photo-1598103442097-8b74394b95c6'),
    desc: 'Half chicken, rosemary garlic, pan juices.',
  },

  // 🍰 Desserts (2)
  {
    id: 'dessert-lava',
    name: 'Chocolate Lava Cake',
    category: 'desserts',
    price: 12,
    rating: 4.9,
    time: 15,
    img: img('photo-1624353365286-3f8d62daad51'),
    desc: 'Warm dark chocolate centre, vanilla cream.',
  },
  {
    id: 'dessert-cheesecake',
    name: 'Vanilla Bean Cheesecake',
    category: 'desserts',
    price: 11,
    rating: 4.8,
    time: 12,
    img: img('photo-1533134242443-d4fd215305ad'),
    desc: 'New York style, berry compote, shortbread base.',
  },

  // 🥤 Drinks (3) — Water is the SOS cover item
  {
    id: 'drink-flatwhite',
    name: 'Flat White',
    category: 'drinks',
    price: 5,
    rating: 4.8,
    time: 8,
    img: img('photo-1495474472287-4d71bcdd2085'),
    desc: 'Double ristretto, steamed milk, fine microfoam.',
  },
  {
    id: 'drink-citrus',
    name: 'Citrus Spark Mocktail',
    category: 'drinks',
    price: 8,
    rating: 4.7,
    time: 10,
    img: img('photo-1514362545857-3bc16c4c7d1b'),
    desc: 'Yuzu, lime, soda, mint — zero alcohol.',
  },
]

/** Cover dish — looks like a normal drink; unlocks the secret SOS report flow. */
export const WATER_ITEM: MenuItem = {
  id: 'water',
  name: 'Water',
  category: 'drinks',
  price: 2,
  rating: 4.9,
  time: 5,
  secretEntry: true,
  img: img('photo-1548839140-29a749e1cf4d'),
  desc: 'Still mineral water · chilled glass.',
}

export const MENU: MenuItem[] = [...SIGNATURE_MENU, WATER_ITEM]

export const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, '') || 'http://127.0.0.1:8000'

export const PASSPORT_TOKEN_KEY = 'safra_passport_token'
export const ADMIN_KEY_STORAGE = 'safra_admin_key'

export const SUGGESTIONS = [
  'Truffle Wagyu Burger',
  'Tonkotsu Ramen',
  'Angus Ribeye',
  'Burrata Margherita',
  'Chocolate Lava Cake',
] as const
