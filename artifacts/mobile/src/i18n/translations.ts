export const translations = {
  en: {
    // App
    appName: 'Al-Ghazaly',
    appTagline: 'Luxury Dining Experience',

    // Navigation
    home: 'Home',
    categories: 'Menu',
    cart: 'My Order',
    profile: 'Profile',
    search: 'Search',

    // Home
    welcome: 'Welcome to Al-Ghazaly',
    searchPlaceholder: 'Search dishes, cuisines, combo meals...',
    shopByCategory: 'Browse the Menu',
    carBrands: 'Cuisines',
    productBrands: 'Combo Meals',
    viewAll: 'View All',

    // Categories
    allCategories: 'Full Menu',
    subcategories: 'Sub-menu',

    // Products
    products: 'Dishes',
    noProducts: 'No dishes found',
    price: 'Price',
    addToCart: 'Add to Order',
    outOfStock: 'Currently Unavailable',
    sku: 'Item Code',
    description: 'Description',
    compatibleWith: 'Served at',

    // Cart
    myCart: 'My Order',
    emptyCart: 'Your order is empty',
    total: 'Total',
    checkout: 'Place Order',
    removeItem: 'Remove',
    quantity: 'Quantity',
    continueShopping: 'Keep Browsing',

    // Orders
    placeOrder: 'Confirm Order',
    shippingAddress: 'Delivery Address',
    phone: 'Phone Number',
    notes: 'Special Requests (Optional)',
    orderPlaced: 'Order Placed Successfully!',
    myOrders: 'My Orders',
    orderDate: 'Order Date',
    orderStatus: 'Status',
    orderTotal: 'Total',
    pending: 'Confirmed',
    processing: 'Preparing',
    shipped: 'Out for Delivery',
    delivered: 'Served',

    // Auth
    login: 'Sign In',
    logout: 'Sign Out',
    loginWithGoogle: 'Continue with Google',
    loginRequired: 'Please sign in to continue',
    welcomeBack: 'Welcome back',

    // Profile
    myProfile: 'My Profile',
    settings: 'Settings',
    darkMode: 'Dark Mode',
    language: 'Language',

    // Search
    advancedSearch: 'Find Your Dish',
    filterByBrand: 'Filter by Cuisine',
    filterByCategory: 'Filter by Menu Section',
    filterByProductBrand: 'Filter by Combo Meal',
    priceRange: 'Price Range',
    applyFilters: 'Apply Filters',
    clearFilters: 'Clear Filters',
    searchResults: 'Search Results',

    // Common
    loading: 'Loading...',
    error: 'Something went wrong',
    retry: 'Retry',
    cancel: 'Cancel',
    save: 'Save',
    confirm: 'Confirm',
    back: 'Back',
    notifications: 'Notifications',
  },
  ar: {
    // App
    appName: 'الغزالي',
    appTagline: 'تجربة طعام فاخرة',

    // Navigation
    home: 'الرئيسية',
    categories: 'القائمة',
    cart: 'طلبي',
    profile: 'الملف الشخصي',
    search: 'بحث',

    // Home
    welcome: 'مرحباً بك في الغزالي',
    searchPlaceholder: 'ابحث عن طبق، مطبخ، أو وجبة كومبو...',
    shopByCategory: 'تصفّح القائمة',
    carBrands: 'المأكولات العالمية',
    productBrands: 'وجبات الكومبو',
    viewAll: 'عرض الكل',

    // Categories
    allCategories: 'القائمة الكاملة',
    subcategories: 'القوائم الفرعية',

    // Products
    products: 'الأطباق',
    noProducts: 'لا توجد أطباق مطابقة',
    price: 'السعر',
    addToCart: 'أضف إلى الطلب',
    outOfStock: 'غير متوفر حالياً',
    sku: 'رمز الطبق',
    description: 'الوصف',
    compatibleWith: 'يُقدَّم في',

    // Cart
    myCart: 'طلبي',
    emptyCart: 'طلبك فارغ',
    total: 'الإجمالي',
    checkout: 'إتمام الطلب',
    removeItem: 'حذف',
    quantity: 'الكمية',
    continueShopping: 'متابعة التصفّح',

    // Orders
    placeOrder: 'تأكيد الطلب',
    shippingAddress: 'عنوان التوصيل',
    phone: 'رقم الهاتف',
    notes: 'طلبات خاصة (اختياري)',
    orderPlaced: 'تم استلام طلبك بنجاح!',
    myOrders: 'طلباتي',
    orderDate: 'تاريخ الطلب',
    orderStatus: 'الحالة',
    orderTotal: 'الإجمالي',
    pending: 'تم التأكيد',
    processing: 'قيد التحضير',
    shipped: 'في الطريق إليك',
    delivered: 'تم التوصيل',

    // Auth
    login: 'تسجيل الدخول',
    logout: 'تسجيل الخروج',
    loginWithGoogle: 'الدخول بحساب جوجل',
    loginRequired: 'يرجى تسجيل الدخول للمتابعة',
    welcomeBack: 'أهلاً بعودتك',

    // Profile
    myProfile: 'ملفي الشخصي',
    settings: 'الإعدادات',
    darkMode: 'الوضع الداكن',
    language: 'اللغة',

    // Search
    advancedSearch: 'ابحث عن طبقك المفضّل',
    filterByBrand: 'حسب نوع المطبخ',
    filterByCategory: 'حسب قسم القائمة',
    filterByProductBrand: 'حسب وجبة الكومبو',
    priceRange: 'نطاق السعر',
    applyFilters: 'تطبيق الفلاتر',
    clearFilters: 'مسح الفلاتر',
    searchResults: 'نتائج البحث',

    // Common
    loading: 'جارِ التحميل...',
    error: 'حدث خطأ غير متوقع',
    retry: 'إعادة المحاولة',
    cancel: 'إلغاء',
    save: 'حفظ',
    confirm: 'تأكيد',
    back: 'رجوع',
    notifications: 'الإشعارات',
  }
};

export type Language = keyof typeof translations;
export type TranslationKey = keyof typeof translations.en;
