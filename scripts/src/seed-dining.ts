/**
 * Al-Ghazaly Dining — Professional Seed Script
 * Clears all existing products/restaurants/brands/categories and inserts
 * 5 professional restaurants, 5 kitchen brands, 5 chef brands, 5 categories,
 * and 15 base products (family meals / drinks / extras) with size variants.
 *
 * Run: pnpm --filter @workspace/scripts run seed:dining
 */
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function q(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function seed() {
  console.log('\n🌱 Al-Ghazaly Dining — Starting professional seed...\n');

  // ── 1. CLEAR EXISTING DATA (dependency order) ────────────────────────────────
  console.log('🗑️  Clearing existing data...');
  await q(`UPDATE products SET deleted_at = NOW() WHERE deleted_at IS NULL`);
  await q(`DELETE FROM products WHERE 1=1`);
  await q(`DELETE FROM car_models WHERE 1=1`);
  await q(`DELETE FROM categories WHERE 1=1`);
  await q(`DELETE FROM product_brands WHERE 1=1`);
  await q(`DELETE FROM car_brands WHERE 1=1`);
  console.log('   ✓ All tables cleared\n');

  // ── 2. KITCHEN BRANDS — منشأ المطبخ (car_brands) ────────────────────────────
  console.log('🏭 Adding kitchen brands (منشأ المطبخ)...');
  const kbRes = await q(`
    INSERT INTO car_brands (name, name_ar, logo_url) VALUES
    ('Al-Ghazaly Authentic Kitchens', 'الغزالي الأصيل',   'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=400&q=80'),
    ('East Kitchens',                 'مطابخ الشرق',       'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&q=80'),
    ('Nile Food House',               'النيل للطعام',      'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&q=80'),
    ('Art Kitchens',                  'مطابخ الفن',        'https://images.unsplash.com/photo-1493770348161-369560ae357d?w=400&q=80'),
    ('Sham Kitchen Heritage',         'مطبخ الشام التراثي','https://images.unsplash.com/photo-1530062845289-9109b2c9c868?w=400&q=80')
    RETURNING id, name_ar
  `);
  const kitchenIds = kbRes.rows.map((r: any) => r.id as string);
  console.log(`   ✓ ${kbRes.rows.length} kitchen brands added\n`);

  // ── 3. CHEF BRANDS — ماركات الشيف (product_brands) ──────────────────────────
  console.log('👨‍🍳 Adding chef brands (ماركات الشيف)...');
  const cbRes = await q(`
    INSERT INTO product_brands (name, name_ar, description, image_url, sort_order) VALUES
    ('Chef Ahmed Yasser',       'الشيف أحمد ياسر',         'Master of authentic Egyptian cuisine with 20+ years experience',    'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&q=80', 1),
    ('Chef Mona Hussein',       'الشيف منى حسين',          'Mediterranean and Arabic fusion cuisine specialist',                'https://images.unsplash.com/photo-1577219491135-ce391730fb2c?w=400&q=80', 2),
    ('Chef Tarek Rashid',       'الشيف طارق رشيد',         'Grill master and Arabic heritage recipes expert',                  'https://images.unsplash.com/photo-1508424757105-b6d5ad9329d0?w=400&q=80', 3),
    ('Chef Layla Abdulrahman',  'الشيف ليلى عبد الرحمن',   'Pastry, desserts and Arabic sweets specialist',                    'https://images.unsplash.com/photo-1571091718767-18b5b1457add?w=400&q=80', 4),
    ('Chef Hossam Abou El-Saud','الشيف حسام أبو السعود',   'Celebrity chef and culinary TV show host',                         'https://images.unsplash.com/photo-1592861956120-e524fc739696?w=400&q=80', 5)
    RETURNING id, name_ar
  `);
  const chefIds = cbRes.rows.map((r: any) => r.id as string);
  console.log(`   ✓ ${cbRes.rows.length} chef brands added\n`);

  // ── 4. RESTAURANTS — المطاعم (car_models) ────────────────────────────────────
  console.log('🏪 Adding restaurants (المطاعم)...');
  const restRes = await q(`
    INSERT INTO car_models (car_brand_id, name, name_ar, description, description_ar, image_url, tables_count) VALUES
    ($1, 'Al-Ghazaly Main – Maadi',      'مطعم الغزالي الرئيسي – المعادي',   'Our flagship restaurant in the heart of Maadi',                'مطعمنا الرئيسي في قلب المعادي بأجواء فاخرة',               'https://images.unsplash.com/photo-1514190051997-0f6f39ca5cde?w=800&q=80', 20),
    ($2, 'Nile Branch – Zamalek',         'فرع النيل – الزمالك',               'Premium waterfront dining with Nile views',                     'مطعم فاخر على ضفاف النيل بإطلالة خلابة',                   'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&q=80', 16),
    ($3, 'Pyramid Branch – Giza',         'فرع الهرم – الجيزة',                'Family dining with a serene Giza atmosphere',                   'مطعم عائلي بأجواء هادئة في منطقة الأهرامات',               'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80', 18),
    ($4, 'Nasr City Branch',              'فرع مدينة نصر',                     'Modern fast-casual dining in central Nasr City',                'تجربة طعام عصرية في قلب مدينة نصر الحيوية',                'https://images.unsplash.com/photo-1552566626-52f8b828329f?w=800&q=80', 12),
    ($5, 'Sheikh Zayed Branch',           'فرع الشيخ زايد',                    'Upscale dining in the elite Sheikh Zayed district',             'مطعم فاخر في حي الشيخ زايد الراقي',                        'https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?w=800&q=80', 14)
    RETURNING id, name_ar
  `, [kitchenIds[0], kitchenIds[1], kitchenIds[2], kitchenIds[3], kitchenIds[4]]);
  const restIds = restRes.rows.map((r: any) => r.id as string);
  const allRestsJson = JSON.stringify(restIds);
  console.log(`   ✓ ${restRes.rows.length} restaurants added\n`);

  // ── 5. CATEGORIES ─────────────────────────────────────────────────────────────
  console.log('📁 Adding categories...');
  const catRes = await q(`
    INSERT INTO categories (name, name_ar, description, description_ar, image_url, sort_order, is_active) VALUES
    ('Family Meals',   'وجبات عائلية', 'Complete family meal sets for all occasions',          'وجبات عائلية متكاملة لجميع المناسبات',              'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80', 1, true),
    ('Beverages',      'المشروبات',    'Fresh juices, hot drinks, and cold refreshments',      'عصائر طازجة ومشروبات ساخنة وبارده',                 'https://images.unsplash.com/photo-1546173159-315724a31696?w=800&q=80', 2, true),
    ('Extras & Sides', 'الإضافات',    'Sauces, sides, and accompaniments',                    'صلصات وأطباق جانبية ومرافقات',                      'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=800&q=80', 3, true),
    ('Grills',         'المشويات',    'Premium grilled meats, chicken, and seafood',           'مشويات فاخرة من اللحوم والدواجن والمأكولات البحرية', 'https://images.unsplash.com/photo-1558030006-450675393462?w=800&q=80', 4, true),
    ('Desserts',       'الحلويات',    'Traditional and modern Arabic desserts',                'حلويات عربية تقليدية وعصرية',                        'https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=800&q=80', 5, true)
    RETURNING id, name_ar
  `);
  const catMap: Record<string, string> = {};
  catRes.rows.forEach((r: any) => { catMap[r.name_ar] = r.id; });
  console.log(`   ✓ ${catRes.rows.length} categories added\n`);

  // Helper: insert a base product + size variants
  async function insertProductFamily(opts: {
    sku: string; name: string; name_ar: string; desc: string; desc_ar: string;
    basePrice: number; img: string; catId: string; chefId: string; sortOrder: number;
    sizes: { indicator: string; multiplier: number }[];
  }) {
    const imgs = JSON.stringify([opts.img]);
    // Insert base (صغير)
    await q(`
      INSERT INTO products
        (name, name_ar, description, description_ar, price, stock_quantity,
         image_url, images, category_id, product_brand_id, sku,
         fitment_indicator, car_model_ids, is_active, is_featured, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13::jsonb,true,true,$14)
    `, [
      opts.name, opts.name_ar, opts.desc, opts.desc_ar,
      opts.basePrice, 100, opts.img, imgs,
      opts.catId, opts.chefId, opts.sku, 'صغير',
      allRestsJson, opts.sortOrder,
    ]);
    // Insert size variants
    for (const s of opts.sizes) {
      await q(`
        INSERT INTO products
          (name, name_ar, description, description_ar, price, stock_quantity,
           image_url, images, category_id, product_brand_id, sku,
           fitment_indicator, car_model_ids, is_active, is_featured, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13::jsonb,true,false,$14)
      `, [
        opts.name, opts.name_ar, opts.desc, opts.desc_ar,
        Math.round(opts.basePrice * s.multiplier), 80, opts.img, imgs,
        opts.catId, opts.chefId, opts.sku, s.indicator,
        allRestsJson, opts.sortOrder,
      ]);
    }
  }

  const MEAL_SIZES = [
    { indicator: 'وسط',   multiplier: 1.30 },
    { indicator: 'كبير',  multiplier: 1.60 },
    { indicator: 'كومبو', multiplier: 1.90 },
    { indicator: 'عائلي', multiplier: 2.30 },
  ];
  const DRINK_SIZES = [
    { indicator: 'وسط',  multiplier: 1.40 },
    { indicator: 'كبير', multiplier: 1.80 },
  ];

  // ── 6. FAMILY MEAL PRODUCTS (5) ───────────────────────────────────────────────
  console.log('🍽️  Adding family meal products (وجبات عائلية)...');
  const mealCatId = catMap['وجبات عائلية'];
  const familyMeals = [
    {
      sku: 'MEAL-001', sortOrder: 1, chefId: chefIds[0], basePrice: 185,
      name: 'Herb Grilled Chicken Platter',    name_ar: 'طبق الدجاج المشوي بالأعشاب',
      desc: 'Whole grilled chicken marinated with Mediterranean herbs and spices, served with rice and mixed salad',
      desc_ar: 'دجاجة مشوية كاملة متبلة بالأعشاب والتوابل المتوسطية، تُقدم مع الأرز والسلطة المشكلة',
      img: 'https://images.unsplash.com/photo-1598103442097-8b74394b95c8?w=800&q=80',
    },
    {
      sku: 'MEAL-002', sortOrder: 2, chefId: chefIds[2], basePrice: 120,
      name: 'Al-Ghazaly Classic Smash Burger',  name_ar: 'برجر الغزالي الكلاسيكي المضغوط',
      desc: 'Double smash beef patty with caramelized onions, special house sauce, and crispy seasoned fries',
      desc_ar: 'برجر لحم بقري مزدوج مضغوط مع البصل المكرمل والصلصة الخاصة وبطاطس مقرمشة متبلة',
      img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&q=80',
    },
    {
      sku: 'MEAL-003', sortOrder: 3, chefId: chefIds[0], basePrice: 95,
      name: 'Traditional Fried Kibbeh',         name_ar: 'كبة مقلية تقليدية باللحم',
      desc: 'Golden fried kibbeh shells filled with minced lamb, pine nuts, and aromatic spices',
      desc_ar: 'كبة مقلية ذهبية محشوة بلحم الضأن المفروم والصنوبر والبهارات العطرية',
      img: 'https://images.unsplash.com/photo-1603360946369-dc9bb6258143?w=800&q=80',
    },
    {
      sku: 'MEAL-004', sortOrder: 4, chefId: chefIds[1], basePrice: 85,
      name: 'Chicken Shawarma Wrap',             name_ar: 'شاورما الدجاج الأصيلة',
      desc: 'Slow-roasted marinated chicken shawarma with garlic sauce, pickles, and fresh vegetables in Arabic bread',
      desc_ar: 'شاورما دجاج مدار ببطء مع صلصة الثوم والمخللات والخضروات الطازجة في خبز عربي طازج',
      img: 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=800&q=80',
    },
    {
      sku: 'MEAL-005', sortOrder: 5, chefId: chefIds[2], basePrice: 210,
      name: 'Al-Ghazaly Mixed Family Pizza',     name_ar: 'بيتزا الغزالي المشكلة العائلية',
      desc: 'Family-size pizza loaded with premium toppings: beef, chicken, mixed vegetables, and signature cheese blend',
      desc_ar: 'بيتزا عائلية محملة بأفضل المكونات: لحم بقري، دجاج، خضروات مشكلة، ومزيج الجبن الخاص',
      img: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800&q=80',
    },
  ];
  for (const m of familyMeals) await insertProductFamily({ ...m, catId: mealCatId, sizes: MEAL_SIZES });
  console.log(`   ✓ ${familyMeals.length} family meals added (each with 5 size variants)\n`);

  // ── 7. BEVERAGE PRODUCTS (5) ──────────────────────────────────────────────────
  console.log('🥤 Adding beverage products (المشروبات)...');
  const drinkCatId = catMap['المشروبات'];
  const drinks = [
    {
      sku: 'DRNK-001', sortOrder: 1, chefId: chefIds[1], basePrice: 45,
      name: 'Fresh Mango Juice',                name_ar: 'عصير المانجو الطازج',
      desc: 'Pure freshly-squeezed mango juice — no added sugar, no water',
      desc_ar: 'عصير مانجو طازج خالص مُعصَّر في نفس اللحظة بدون إضافة سكر أو ماء',
      img: 'https://images.unsplash.com/photo-1546173159-315724a31696?w=800&q=80',
    },
    {
      sku: 'DRNK-002', sortOrder: 2, chefId: chefIds[3], basePrice: 35,
      name: 'Mint Lemonade',                    name_ar: 'الليموناضة بالنعناع الطازج',
      desc: 'Refreshing lemonade with fresh garden mint, a touch of sugar cane, and crushed ice',
      desc_ar: 'ليموناضة منعشة مع نعناع الحديقة الطازج ولمسة من عصير قصب السكر والثلج المجروش',
      img: 'https://images.unsplash.com/photo-1621263764928-df1444c5e859?w=800&q=80',
    },
    {
      sku: 'DRNK-003', sortOrder: 3, chefId: chefIds[1], basePrice: 30,
      name: 'Premium Iced English Tea',          name_ar: 'الشاي الإنجليزي المثلج الفاخر',
      desc: 'Brewed English breakfast tea served chilled with lemon slices and fresh mint sprigs',
      desc_ar: 'شاي إنجليزي مُعَدّ بعناية ومُبرَّد مع شرائح الليمون وأغصان النعناع الطازج',
      img: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=800&q=80',
    },
    {
      sku: 'DRNK-004', sortOrder: 4, chefId: chefIds[0], basePrice: 55,
      name: 'Al-Ghazaly Signature Arabic Coffee', name_ar: 'قهوة الغزالي الأصيلة بالهيل',
      desc: 'Premium Arabic coffee blend with cardamom, saffron, and rose water — served in traditional dallah',
      desc_ar: 'مزيج قهوة عربية فاخرة بالهيل والزعفران وماء الورد — تُقدم في دلة تراثية أصيلة',
      img: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&q=80',
    },
    {
      sku: 'DRNK-005', sortOrder: 5, chefId: chefIds[3], basePrice: 60,
      name: 'Tropical Fruit Smoothie',           name_ar: 'سموذي الفواكه الاستوائية',
      desc: 'A vibrant blend of strawberry, mango, banana, and passion fruit with creamy Greek yogurt',
      desc_ar: 'مزيج نابض بالحياة من الفراولة والمانجو والموز وفاكهة العاطفة مع الزبادي اليوناني الكريمي',
      img: 'https://images.unsplash.com/photo-1502741224143-90386d7f8c82?w=800&q=80',
    },
  ];
  for (const d of drinks) await insertProductFamily({ ...d, catId: drinkCatId, sizes: DRINK_SIZES });
  console.log(`   ✓ ${drinks.length} drinks added (each with 3 size variants)\n`);

  // ── 8. EXTRAS PRODUCTS (5) ────────────────────────────────────────────────────
  console.log('🧄 Adding extras & sides (الإضافات)...');
  const extrasCatId = catMap['الإضافات'];
  const extras = [
    {
      sku: 'XTRA-001', sortOrder: 1, chefId: chefIds[0], basePrice: 20,
      name: 'Spicy Roasted Garlic Sauce',       name_ar: 'صلصة الثوم المحمص الحارة',
      desc: 'House-made slow-roasted garlic sauce with a bold spicy kick — perfect with any dish',
      desc_ar: 'صلصة ثوم محمص ببطء خاصة بنا مع لمسة حارة جريئة — مثالية مع أي طبق',
      img: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=800&q=80',
    },
    {
      sku: 'XTRA-002', sortOrder: 2, chefId: chefIds[2], basePrice: 15,
      name: 'Fresh Baked Pita Bread',           name_ar: 'خبز البيتا الطازج من الفرن',
      desc: 'Freshly baked Arabic pita bread — soft, warm, and fluffy straight from the stone oven',
      desc_ar: 'خبز بيتا عربي طازج من الفرن الحجري — طري ودافئ ومنتفخ من الفرن مباشرة',
      img: 'https://images.unsplash.com/photo-1598373182133-52452f7691ef?w=800&q=80',
    },
    {
      sku: 'XTRA-003', sortOrder: 3, chefId: chefIds[1], basePrice: 25,
      name: 'Creamy Classic Coleslaw',          name_ar: 'سلطة الكول سلو الكريمية الكلاسيكية',
      desc: 'Classic American-style coleslaw with crispy cabbage, carrots, and our signature creamy dressing',
      desc_ar: 'سلطة كول سلو على الطريقة الكلاسيكية مع الكرنب المقرمش والجزر وخلطتنا الكريمية الخاصة',
      img: 'https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=800&q=80',
    },
    {
      sku: 'XTRA-004', sortOrder: 4, chefId: chefIds[4], basePrice: 35,
      name: 'Crispy Seasoned French Fries',     name_ar: 'بطاطس محمرة مقرمشة بالتتبيلة الخاصة',
      desc: 'Golden crispy french fries tossed in our signature 7-spice blend — addictively delicious',
      desc_ar: 'بطاطس محمرة ذهبية مقرمشة متبلة بخلطة السبع بهارات الخاصة بنا — لا تقاوم',
      img: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=800&q=80',
    },
    {
      sku: 'XTRA-005', sortOrder: 5, chefId: chefIds[3], basePrice: 18,
      name: 'Rustic Italian Tomato Sauce',      name_ar: 'صلصة الطماطم الإيطالية الريفية',
      desc: 'Slow-simmered crushed tomato sauce with fresh basil, garlic, and Mediterranean herbs',
      desc_ar: 'صلصة طماطم مهروسة مطبوخة ببطء مع الريحان الطازج والثوم وأعشاب البحر المتوسط',
      img: 'https://images.unsplash.com/photo-1564834724105-918b73d2af9e?w=800&q=80',
    },
  ];
  for (const e of extras) await insertProductFamily({ ...e, catId: extrasCatId, sizes: [] });
  console.log(`   ✓ ${extras.length} extras added (single size each)\n`);

  // ── SUMMARY ───────────────────────────────────────────────────────────────────
  const productCount = (await q(`SELECT COUNT(*) FROM products`)).rows[0].count;
  console.log('🎉 Seed completed successfully!\n');
  console.log('📊 Summary:');
  console.log(`   • 5 kitchen brands    (منشأ المطبخ)`);
  console.log(`   • 5 chef brands       (ماركات الشيف)`);
  console.log(`   • 5 restaurants       (المطاعم)`);
  console.log(`   • 5 categories        (الفئات)`);
  console.log(`   • 5 family meals × 5 sizes = 25 product rows`);
  console.log(`   • 5 drinks × 3 sizes  = 15 product rows`);
  console.log(`   • 5 extras × 1 size   =  5 product rows`);
  console.log(`   • Total product rows  = ${productCount}\n`);

  await pool.end();
}

seed().catch((err) => {
  console.error('\n❌ Seed failed:', err.message || err);
  process.exit(1);
});
