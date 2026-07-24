export const SITE = {
  name: 'Safra',
  tagline: 'Order food. Delivered fast.',
  subheading: 'Browse the menu, add to cart, and checkout in minutes.',
} as const

export const NAV = [
  { label: 'Menu', href: '#menu' },
  { label: 'Cart', href: '#order' },
] as const

export const CATEGORIES = [
  { id: 'pizza', label: 'Pizza', emoji: '🍕' },
  { id: 'burger', label: 'Burger', emoji: '🍔' },
  { id: 'chicken', label: 'Chicken', emoji: '🍗' },
  { id: 'ramen', label: 'Ramen', emoji: '🍜' },
  { id: 'sushi', label: 'Sushi', emoji: '🍣' },
  { id: 'steak', label: 'Steak', emoji: '🥩' },
  { id: 'mexican', label: 'Mexican', emoji: '🌮' },
  { id: 'chinese', label: 'Chinese', emoji: '🥟' },
  { id: 'italian', label: 'Italian', emoji: '🍝' },
  { id: 'indian', label: 'Indian', emoji: '🥘' },
  { id: 'middle-eastern', label: 'Middle Eastern', emoji: '🥙' },
  { id: 'healthy', label: 'Healthy', emoji: '🥗' },
  { id: 'sandwiches', label: 'Sandwiches', emoji: '🥪' },
  { id: 'wraps', label: 'Wraps', emoji: '🌯' },
  { id: 'rice', label: 'Rice Bowls', emoji: '🍛' },
  { id: 'snacks', label: 'Snacks', emoji: '🍟' },
  { id: 'desserts', label: 'Desserts', emoji: '🍩' },
  { id: 'cakes', label: 'Cakes', emoji: '🍰' },
  { id: 'bubble-tea', label: 'Bubble Tea', emoji: '🧋' },
  { id: 'coffee', label: 'Coffee', emoji: '☕' },
  { id: 'mocktails', label: 'Mocktails', emoji: '🍹' },
  { id: 'soft-drinks', label: 'Soft Drinks', emoji: '🥤' },
  { id: 'beverages', label: 'Beverages', emoji: '🍺' },
] as const

type CatId = (typeof CATEGORIES)[number]['id']

const IMAGES: Record<string, string[]> = {
  pizza: [
    'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=1600&q=90',
  ],
  burger: [
    'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?auto=format&fit=crop&w=1600&q=90',
  ],
  chicken: [
    'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?auto=format&fit=crop&w=1600&q=90',
  ],
  ramen: [
    'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1617093727343-374698b1b08d?auto=format&fit=crop&w=1600&q=90',
  ],
  sushi: [
    'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1553621042-f6e147245754?auto=format&fit=crop&w=1600&q=90',
  ],
  steak: [
    'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1600891964092-4316c288032e?auto=format&fit=crop&w=1600&q=90',
  ],
  mexican: [
    'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1599974579688-8dbdd335c77f?auto=format&fit=crop&w=1600&q=90',
  ],
  chinese: [
    'https://images.unsplash.com/photo-1525755662778-989d0524087e?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=1600&q=90',
  ],
  italian: [
    'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=1600&q=90',
  ],
  indian: [
    'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=1600&q=90',
  ],
  'middle-eastern': [
    'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?auto=format&fit=crop&w=1600&q=90',
  ],
  healthy: [
    'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=1600&q=90',
  ],
  sandwiches: [
    'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=1600&q=90',
  ],
  wraps: [
    'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?auto=format&fit=crop&w=1600&q=90',
  ],
  rice: [
    'https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=1600&q=90',
  ],
  snacks: [
    'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=1600&q=90',
  ],
  desserts: [
    'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=1600&q=90',
  ],
  cakes: [
    'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=1600&q=90',
  ],
  'bubble-tea': [
    'https://images.unsplash.com/photo-1558857563-b371033873b8?auto=format&fit=crop&w=1600&q=90',
  ],
  coffee: [
    'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=1600&q=90',
  ],
  mocktails: [
    'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=1600&q=90',
  ],
  'soft-drinks': [
    'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=1600&q=90',
  ],
  beverages: [
    'https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=1600&q=90',
  ],
}

const NAMES: Record<string, string[]> = {
  pizza: ['Truffle Margherita', 'Fire Pepperoni', 'Bianca Cloud', 'Wild Mushroom', 'Smoked Burrata'],
  burger: ['Safra Smash', 'Wagyu Crown', 'Midnight Stack', 'Crisp Garden', 'Gold Cheddar'],
  chicken: ['Honey Char', 'Crisp Karaage', 'Smoke Wings', 'Herb Roast', 'Chili Glaze'],
  ramen: ['Tonkotsu Night', 'Miso Ember', 'Spicy Shoyu', 'Black Garlic', 'Yuzu Cloud'],
  sushi: ['Omakase Twelve', 'Dragon Roll', 'Sashimi Prism', 'Tempura Soft', 'Salmon Bloom'],
  steak: ['Prime Ribeye', 'Butter Filet', 'Char Strip', 'Pepper Crust', 'Bone-In Night'],
  mexican: ['Street Al Pastor', 'Fire Carnitas', 'Verde Bowl', 'Crisp Queso', 'Smoke Birria'],
  chinese: ['Silk Dumplings', 'Wok Flame', 'Mapo Soft', 'Crisp Peking', 'Ginger Steam'],
  italian: ['Carbonara Silk', 'Cacio e Pepe', 'Wild Pesto', 'Lobster Rigatoni', 'Truffle Tagli'],
  indian: ['Butter Cloud', 'Tandoori Ember', 'Lamb Rogan', 'Paneer Smoke', 'Biryani Crown'],
  'middle-eastern': ['Zaatar Wrap', 'Lamb Shawarma', 'Hummus Garden', 'Falafel Gold', 'Halloumi Fire'],
  healthy: ['Green Prism', 'Quinoa Dawn', 'Avocado Lift', 'Kale Voltage', 'Citrus Bowl'],
  sandwiches: ['Club Safra', 'Turkey Smoke', 'Caprese Soft', 'Cubano Heat', 'Egg Cloud'],
  wraps: ['Chipotle Wrap', 'Greek Fold', 'Thai Crunch', 'Harvest Wrap', 'Spicy Tofu'],
  rice: ['Teriyaki Bowl', 'Korean Fire', 'Poke Safra', 'Curry Lift', 'Sesame Bowl'],
  snacks: ['Truffle Fries', 'Loaded Nachos', 'Crisp Rings', 'Tempura Bits', 'Cheese Puffs'],
  desserts: ['Lava Core', 'Matcha Soft', 'Caramel Drift', 'Berry Glass', 'Choco Orbit'],
  cakes: ['Velvet Slice', 'Lemon Cloud', 'Opera Night', 'Basque Burn', 'Tiramisu Soft'],
  'bubble-tea': ['Brown Sugar', 'Taro Glow', 'Matcha Pearl', 'Lychee Ice', 'Sesame Milk'],
  coffee: ['Flat White', 'Nitro Cold', 'Cortado Soft', 'Espresso Hit', 'Oat Latte'],
  mocktails: ['Yuzu Spark', 'Berry Zero', 'Smoke Pine', 'Ginger Lift', 'Citrus Neon'],
  'soft-drinks': ['Cola Zero', 'Citrus Fizz', 'Berry Pop', 'Ginger Ale', 'Spark Water'],
  beverages: ['Craft Lager', 'Pale Safra', 'Wheat Soft', 'Dark Ember', 'Cider Light'],
}

function hash(n: number) {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

export type MenuItem = {
  id: string
  name: string
  category: CatId
  price: number
  rating: number
  time: number
  calories: number
  chefPick: boolean
  img: string
  desc: string
}

function buildMenu(): MenuItem[] {
  const items: MenuItem[] = []
  let i = 0
  for (const cat of CATEGORIES) {
    const names = NAMES[cat.id] ?? [`${cat.label} Select`]
    const imgs = IMAGES[cat.id] ?? IMAGES.pizza
    // 4–5 per category → ~100+
    const count = 5
    for (let n = 0; n < count; n++) {
      const h = hash(i + 1)
      const name = names[n % names.length] + (n >= names.length ? ` ${n + 1}` : '')
      items.push({
        id: `${cat.id}-${n}`,
        name,
        category: cat.id,
        price: Math.round((8 + h * 28) * 100) / 100,
        rating: Math.round((4.2 + h * 0.8) * 10) / 10,
        time: 12 + Math.floor(h * 28),
        calories: 180 + Math.floor(h * 620),
        chefPick: h > 0.78,
        img: imgs[n % imgs.length],
        desc: `Crafted for Safra · ${cat.label.toLowerCase()} signature`,
      })
      i++
    }
  }
  // pad to 115 with variants
  while (items.length < 115) {
    const base = items[items.length % 100]
    const h = hash(items.length + 7)
    items.push({
      ...base,
      id: `extra-${items.length}`,
      name: `${base.name} Reserve`,
      price: Math.round((base.price + h * 4) * 100) / 100,
      chefPick: h > 0.85,
      rating: Math.min(5, Math.round((base.rating + 0.1) * 10) / 10),
    })
  }
  return items
}

export const MENU: MenuItem[] = buildMenu()

export const SUGGESTIONS = [
  'Truffle burgers near me',
  'Under 20 minutes',
  'Chef picks tonight',
  'Late night ramen',
  'Healthy under 400 cal',
  'Bubble tea + dessert',
] as const
