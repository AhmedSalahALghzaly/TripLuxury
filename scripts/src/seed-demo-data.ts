/**
 * Al-Ghazaly Dining — Demo Data Seed Script
 * Adds 5 complete items to every admin section via the live API.
 * Run:  pnpm --filter @workspace/scripts run seed-demo
 */
import https from 'node:https';
import http from 'node:http';

const BASE = 'http://localhost:80';
const SESSION = process.env.SESSION_COOKIE ?? '';

async function req(
  method: string,
  path: string,
  body?: object,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const payload = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: url.hostname,
      port: Number(url.port) || 80,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session_token=${SESSION}`,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const proto = url.protocol === 'https:' ? https : http;
    const r = proto.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function ok(label: string, r: any) {
  if (r.status >= 400) {
    console.error(`✗ ${label}  HTTP ${r.status}`, JSON.stringify(r.body).slice(0, 200));
    return null;
  }
  console.log(`✓ ${label}  id=${r.body.id}`);
  return r.body;
}

// ─── Image URLs (Unsplash CDN, no auth required) ─────────────────────────────
const IMG = {
  egyptian:  'https://images.unsplash.com/photo-1591283155405-95daf4b49e25?w=400&q=80',
  lebanese:  'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?w=400&q=80',
  italian:   'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=400&q=80',
  turkish:   'https://images.unsplash.com/photo-1561043433-aaf687c4cf04?w=400&q=80',
  indian:    'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=400&q=80',
  rest1:     'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80',
  rest2:     'https://images.unsplash.com/photo-1537047902294-62a40c20a6ae?w=800&q=80',
  rest3:     'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80',
  rest4:     'https://images.unsplash.com/photo-1552566626-52f8b828329f?w=800&q=80',
  rest5:     'https://images.unsplash.com/photo-1424847651672-bf20a4b0982b?w=800&q=80',
  chef1:     'https://images.unsplash.com/photo-1607631568010-a87245c0daf8?w=200&q=80',
  chef2:     'https://images.unsplash.com/photo-1622021142947-da7dedc7c39a?w=200&q=80',
  chef3:     'https://images.unsplash.com/photo-1572441713132-51c75654db73?w=200&q=80',
  chef4:     'https://images.unsplash.com/photo-1577219491135-ce391730fb2c?w=200&q=80',
  chef5:     'https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=200&q=80',
  cat_grill: 'https://images.unsplash.com/photo-1544025162-d76594e28579?w=300&q=80',
  cat_sea:   'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=300&q=80',
  cat_dessert:'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=300&q=80',
  cat_salad: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=300&q=80',
  cat_main:  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=300&q=80',
  p_koshary: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=600&q=80',
  p_grill:   'https://images.unsplash.com/photo-1544025162-d76594e28579?w=600&q=80',
  p_hummus:  'https://images.unsplash.com/photo-1541529086526-db283c563270?w=600&q=80',
  p_tiramisu:'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=600&q=80',
  p_seabass: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=600&q=80',
};

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log(' Al-Ghazaly Dining — Demo Data Seed');
  console.log('══════════════════════════════════════════════\n');

  // ── 1. Cuisine Origins (car-brands) ────────────────────────────────────────
  console.log('── 1. Cuisine Origins ──────────────────────────');
  const brandsData = [
    { name: 'Egyptian',  name_ar: 'مصري',    logo: IMG.egyptian },
    { name: 'Lebanese',  name_ar: 'لبناني',  logo: IMG.lebanese },
    { name: 'Italian',   name_ar: 'إيطالي',  logo: IMG.italian  },
    { name: 'Turkish',   name_ar: 'تركي',    logo: IMG.turkish  },
    { name: 'Indian',    name_ar: 'هندي',    logo: IMG.indian   },
  ];

  const brandIds: string[] = [];
  for (const b of brandsData) {
    const existing = (await req('GET', '/api/car-brands')).body as any[];
    const found = existing.find((x: any) => x.name === b.name);
    if (found) {
      console.log(`  ↩ already exists: ${b.name}  id=${found.id}`);
      brandIds.push(found.id);
    } else {
      const r = await req('POST', '/api/car-brands', b);
      const created = ok(b.name, r);
      if (created) brandIds.push(created.id);
    }
  }

  if (brandIds.length === 0) {
    console.error('No brand IDs — cannot continue.');
    process.exit(1);
  }

  // ── 2. Restaurants (car-models) ────────────────────────────────────────────
  console.log('\n── 2. Restaurants ──────────────────────────────');
  const restaurantsData = [
    {
      name: 'Koshary House',     name_ar: 'بيت الكشري',
      brand_id: brandIds[0],     fuel_type: 'regular',
      year_start: 2018,          year_end: null,
      chassis_number: 'REST-EG01',
      image_url: IMG.rest1,
      images: [IMG.rest1],
      description: 'Authentic Egyptian Koshary restaurant serving the finest traditional dishes since 2018.',
      description_ar: 'مطعم كشري مصري أصيل يقدم أفضل الأطباق التقليدية منذ عام 2018.',
    },
    {
      name: 'Al-Baalbek',        name_ar: 'البعلبكي',
      brand_id: brandIds[1],     fuel_type: 'halal',
      year_start: 2015,          year_end: null,
      chassis_number: 'REST-LB02',
      image_url: IMG.rest2,
      images: [IMG.rest2],
      description: 'Premium Lebanese cuisine with authentic mezze and fresh grills.',
      description_ar: 'مطبخ لبناني فاخر مع مزة أصيلة ومشاوي طازجة.',
    },
    {
      name: 'Trattoria Roma',    name_ar: 'تراتوريا روما',
      brand_id: brandIds[2],     fuel_type: 'vegetarian',
      year_start: 2020,          year_end: null,
      chassis_number: 'REST-IT03',
      image_url: IMG.rest3,
      images: [IMG.rest3],
      description: 'Classic Italian trattoria offering handmade pasta, wood-fired pizza and tiramisu.',
      description_ar: 'تراتوريا إيطالية كلاسيكية تقدم مكرونة يدوية وبيتزا محمصة وتيراميسو.',
    },
    {
      name: 'Istanbul Kebab',    name_ar: 'إسطنبول كباب',
      brand_id: brandIds[3],     fuel_type: 'halal',
      year_start: 2019,          year_end: null,
      chassis_number: 'REST-TR04',
      image_url: IMG.rest4,
      images: [IMG.rest4],
      description: 'Authentic Turkish kebab and mezes brought straight from Istanbul\'s finest kitchens.',
      description_ar: 'كباب تركي أصيل ومزة مباشرة من أفضل مطابخ إسطنبول.',
    },
    {
      name: 'Spice Garden',      name_ar: 'حديقة البهارات',
      brand_id: brandIds[4],     fuel_type: 'regular',
      year_start: 2021,          year_end: null,
      chassis_number: 'REST-IN05',
      image_url: IMG.rest5,
      images: [IMG.rest5],
      description: 'A fragrant journey through Indian cuisine — curries, tandoor, biryani and more.',
      description_ar: 'رحلة عطرة عبر المطبخ الهندي — كاري وتندور وبريياني والمزيد.',
    },
  ];

  const restaurantIds: string[] = [];
  for (const rest of restaurantsData) {
    const existing = (await req('GET', '/api/car-models')).body as any[];
    const found = existing.find((x: any) => x.name === rest.name);
    if (found) {
      console.log(`  ↩ already exists: ${rest.name}  id=${found.id}`);
      restaurantIds.push(found.id);
    } else {
      const r = await req('POST', '/api/car-models', rest);
      const created = ok(rest.name, r);
      if (created) restaurantIds.push(created.id);
    }
  }

  // ── 3. Chef Brands (product-brands) ────────────────────────────────────────
  console.log('\n── 3. Chef Brands ──────────────────────────────');
  const chefsData = [
    { name: 'Chef Ahmed Hassan',  name_ar: 'الشيف أحمد حسن',   logo: IMG.chef1, country_of_origin: 'Egypt',  country_of_origin_ar: 'مصر'      },
    { name: 'Chef Mohamed Masri', name_ar: 'الشيف محمد المصري', logo: IMG.chef2, country_of_origin: 'Egypt',  country_of_origin_ar: 'مصر'      },
    { name: 'Chef Sara Khalil',   name_ar: 'الشيف سارة خليل',   logo: IMG.chef3, country_of_origin: 'Lebanon',country_of_origin_ar: 'لبنان'    },
    { name: 'Chef Hassan Ali',    name_ar: 'الشيف حسن علي',     logo: IMG.chef4, country_of_origin: 'Turkey', country_of_origin_ar: 'تركيا'    },
    { name: 'Chef Layla Omar',    name_ar: 'الشيف ليلى عمر',    logo: IMG.chef5, country_of_origin: 'India',  country_of_origin_ar: 'الهند'    },
  ];

  const chefIds: string[] = [];
  for (const c of chefsData) {
    const existing = (await req('GET', '/api/product-brands')).body as any[];
    const found = existing.find((x: any) => x.name === c.name);
    if (found) {
      console.log(`  ↩ already exists: ${c.name}  id=${found.id}`);
      chefIds.push(found.id);
    } else {
      const r = await req('POST', '/api/product-brands', c);
      const created = ok(c.name, r);
      if (created) chefIds.push(created.id);
    }
  }

  // ── 4. Categories ───────────────────────────────────────────────────────────
  console.log('\n── 4. Categories ───────────────────────────────');
  const categoriesData = [
    { name: 'Grills & BBQ',        name_ar: 'مشويات',              icon: 'flame',           image_data: IMG.cat_grill   },
    { name: 'Seafood',             name_ar: 'مأكولات بحرية',        icon: 'fish',            image_data: IMG.cat_sea     },
    { name: 'Desserts',            name_ar: 'حلويات',              icon: 'ice-cream',       image_data: IMG.cat_dessert  },
    { name: 'Salads & Starters',   name_ar: 'سلطات ومقبلات',       icon: 'leaf',            image_data: IMG.cat_salad   },
    { name: 'Main Dishes',         name_ar: 'أطباق رئيسية',        icon: 'restaurant',      image_data: IMG.cat_main    },
  ];

  const catIds: string[] = [];
  for (const cat of categoriesData) {
    const existing = (await req('GET', '/api/categories/all')).body as any[];
    const found = existing.find((x: any) => x.name === cat.name);
    if (found) {
      console.log(`  ↩ already exists: ${cat.name}  id=${found.id}`);
      catIds.push(found.id);
    } else {
      const r = await req('POST', '/api/categories', cat);
      const created = ok(cat.name, r);
      if (created) catIds.push(created.id);
    }
  }

  // ── 5. Products ─────────────────────────────────────────────────────────────
  console.log('\n── 5. Products ─────────────────────────────────');
  const productsData = [
    {
      name:            'Special Koshary',
      name_ar:         'كشري مميز',
      description:     'A generous bowl of Egypt\'s beloved street food — layers of rice, lentils, pasta, crispy onions and zesty tomato sauce.',
      description_ar:  'طبق كشري مصري بالمكونات الأصيلة — أرز وعدس ومكرونة وبصل مقلي وصلصة طماطم لاذعة.',
      price:           89,
      sku:             'FOOD-KOS-001',
      category_id:     catIds[4] ?? null,
      product_brand_id:chefIds[0] ?? null,
      image_url:       IMG.p_koshary,
      images:          [IMG.p_koshary],
      car_model_ids:   restaurantIds.slice(0, 2),
      stock_quantity:  50,
      hidden_status:   false,
      product_type:    null,
      ingredients:     ['Rice', 'Brown Lentils', 'Macaroni', 'Chickpeas', 'Fried Onions', 'Tomato Sauce', 'Garlic Vinegar'],
      ingredients_ar:  ['أرز', 'عدس بني', 'مكرونة', 'حمص', 'بصل مقلي', 'صلصة طماطم', 'خل بالثوم'],
      nutrition:       { calories: 520, protein: 18, carbs: 85, fat: 12 },
    },
    {
      name:            'Mixed Grill Platter',
      name_ar:         'مشاوي مشكلة',
      description:     'A lavish platter of charcoal-grilled chicken, kofta, shish tawook and lamb chops served with rice and salad.',
      description_ar:  'طبق فاخر من الفراخ المشوية على الفحم والكفتة والشيش طاووق وضلع خروف مع الأرز والسلطة.',
      price:           245,
      sku:             'FOOD-GRILL-002',
      category_id:     catIds[0] ?? null,
      product_brand_id:chefIds[1] ?? null,
      image_url:       IMG.p_grill,
      images:          [IMG.p_grill],
      car_model_ids:   restaurantIds.slice(1, 3),
      stock_quantity:  30,
      hidden_status:   false,
      product_type:    null,
      ingredients:     ['Chicken', 'Minced Meat', 'Lamb Chops', 'Onion', 'Parsley', 'Mixed Spices', 'Olive Oil'],
      ingredients_ar:  ['دجاج', 'لحم مفروم', 'ضلع خروف', 'بصل', 'بقدونس', 'بهارات مشكلة', 'زيت زيتون'],
      nutrition:       { calories: 780, protein: 62, carbs: 35, fat: 44 },
    },
    {
      name:            'Classic Hummus',
      name_ar:         'حمص كلاسيكي',
      description:     'Silky-smooth hummus drizzled with premium olive oil, paprika and fresh parsley, served with warm pita bread.',
      description_ar:  'حمص ناعم كالحرير مرشوش بزيت الزيتون الفاخر والفلفل الحلو والبقدونس الطازج مع خبز بيتا دافئ.',
      price:           65,
      sku:             'FOOD-HUM-003',
      category_id:     catIds[3] ?? null,
      product_brand_id:chefIds[2] ?? null,
      image_url:       IMG.p_hummus,
      images:          [IMG.p_hummus],
      car_model_ids:   restaurantIds.slice(1, 2),
      stock_quantity:  100,
      hidden_status:   false,
      product_type:    null,
      ingredients:     ['Chickpeas', 'Tahini', 'Lemon Juice', 'Garlic', 'Olive Oil', 'Paprika', 'Parsley'],
      ingredients_ar:  ['حمص', 'طحينة', 'عصير ليمون', 'ثوم', 'زيت زيتون', 'فلفل حلو', 'بقدونس'],
      nutrition:       { calories: 195, protein: 8, carbs: 22, fat: 9 },
    },
    {
      name:            'Tiramisu al-Ghazaly',
      name_ar:         'تيراميسو الغزالي',
      description:     'Our signature Italian-inspired tiramisu with layers of espresso-soaked ladyfingers, mascarpone cream and cocoa dust.',
      description_ar:  'تيراميسو مميز بالإلهام الإيطالي — طبقات من البسكويت المنقوع بالإسبريسو وكريمة الماسكاربوني ومسحوق الكاكاو.',
      price:           125,
      sku:             'FOOD-TIRA-004',
      category_id:     catIds[2] ?? null,
      product_brand_id:chefIds[2] ?? null,
      image_url:       IMG.p_tiramisu,
      images:          [IMG.p_tiramisu],
      car_model_ids:   restaurantIds.slice(2, 3),
      stock_quantity:  40,
      hidden_status:   false,
      product_type:    null,
      ingredients:     ['Mascarpone', 'Ladyfingers', 'Espresso', 'Egg Yolks', 'Sugar', 'Cocoa Powder', 'Heavy Cream'],
      ingredients_ar:  ['ماسكاربوني', 'بسكويت سافويارد', 'إسبريسو', 'صفار بيض', 'سكر', 'كاكاو', 'كريمة مخفوقة'],
      nutrition:       { calories: 340, protein: 7, carbs: 42, fat: 16 },
    },
    {
      name:            'Grilled Sea Bass',
      name_ar:         'باس البحر المشوي',
      description:     'Whole sea bass marinated in herbs and lemon, grilled to perfection, served with saffron rice and roasted vegetables.',
      description_ar:  'سمكة باس كاملة متبلة بالأعشاب والليمون، مشوية بإتقان وتقدم مع أرز زعفران وخضروات محمصة.',
      price:           320,
      sku:             'FOOD-BASS-005',
      category_id:     catIds[1] ?? null,
      product_brand_id:chefIds[3] ?? null,
      image_url:       IMG.p_seabass,
      images:          [IMG.p_seabass],
      car_model_ids:   restaurantIds.slice(0, 1),
      stock_quantity:  20,
      hidden_status:   false,
      product_type:    null,
      ingredients:     ['Sea Bass', 'Lemon', 'Rosemary', 'Thyme', 'Garlic', 'Olive Oil', 'Saffron', 'Seasonal Vegetables'],
      ingredients_ar:  ['سمك باس', 'ليمون', 'روزماري', 'زعتر', 'ثوم', 'زيت زيتون', 'زعفران', 'خضروات موسمية'],
      nutrition:       { calories: 410, protein: 48, carbs: 28, fat: 18 },
    },
  ];

  for (const p of productsData) {
    const { products: existing } = (await req('GET', `/api/products?limit=100`)).body;
    const found = (existing || []).find((x: any) => x.sku === p.sku);
    if (found) {
      console.log(`  ↩ already exists: ${p.name}  sku=${p.sku}`);
    } else {
      const r = await req('POST', '/api/products', p);
      ok(p.name, r);
    }
  }

  console.log('\n══════════════════════════════════════════════');
  console.log(' ✅ Seed complete!');
  console.log('══════════════════════════════════════════════\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
