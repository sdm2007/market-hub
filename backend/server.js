const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const TZ = 'Asia/Kolkata';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '8mb' }));
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir, { maxAge: '7d', immutable: true }));

const db = new sqlite3.Database(path.join(__dirname, 'gramsetu.db'));
db.configure('busyTimeout', 5000);

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
const now = () => new Date().toISOString();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function token() { return crypto.randomBytes(32).toString('hex'); }
function dayName(date = new Date()) { return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(date); }
function timeInIndia(date = new Date()) { return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(date); }
function mins(hhmm) { const [h, m] = String(hhmm || '00:00').split(':').map(Number); return h * 60 + m; }
function formatTime(hhmm) { if (!hhmm) return ''; const [h, m] = hhmm.split(':').map(Number); const d = new Date(2000,0,1,h,m); return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
function distanceRank(d) { return Number(d || 999); }
function haversineKm(lat1, lon1, lat2, lon2) { const toRad = n => n * Math.PI / 180; const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1); const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2; return 6371 * 2 * Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); }

async function ensureColumn(table, column, definition) {
  const cols = await all(`PRAGMA table_info(${table})`);
  if (!cols.some(c => c.name === column)) await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function init() {
  await run(`PRAGMA foreign_keys = ON`);
  await run(`CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL, phone TEXT DEFAULT '', address TEXT DEFAULT '',
    distance REAL DEFAULT 1.0, rating REAL DEFAULT 0, reviews_count INTEGER DEFAULT 0, is_open INTEGER DEFAULT 0, closes_at TEXT DEFAULT '', verified INTEGER DEFAULT 0
  )`);
  await run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, business_id INTEGER NOT NULL, name TEXT NOT NULL, price REAL, type TEXT NOT NULL DEFAULT 'PRODUCT',
    status TEXT DEFAULT 'IN_STOCK', quantity INTEGER DEFAULT 0, description TEXT DEFAULT '', price_type TEXT DEFAULT 'FIXED', price_min REAL, price_max REAL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP, category_attributes TEXT DEFAULT '{}', FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE
  )`);
  await run(`CREATE TABLE IF NOT EXISTS demand_insights (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, increase TEXT NOT NULL, searches INTEGER NOT NULL, action TEXT NOT NULL, period_start TEXT, period_end TEXT)`);
  await run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'CUSTOMER', avatar TEXT, location TEXT, created_at TEXT NOT NULL)`);
  await run(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  await run(`CREATE TABLE IF NOT EXISTS business_owners (business_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, claim_status TEXT NOT NULL DEFAULT 'VERIFIED', FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  await run(`CREATE TABLE IF NOT EXISTS business_hours (business_id INTEGER NOT NULL, day TEXT NOT NULL, is_closed INTEGER DEFAULT 0, open_time TEXT, close_time TEXT, periods_json TEXT DEFAULT '[]', PRIMARY KEY (business_id, day), FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE)`);
  await run(`CREATE TABLE IF NOT EXISTS special_hours (id INTEGER PRIMARY KEY AUTOINCREMENT, business_id INTEGER NOT NULL, date TEXT NOT NULL, is_closed INTEGER DEFAULT 0, open_time TEXT, close_time TEXT, note TEXT DEFAULT '', FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE)`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_special_hours_business_date ON special_hours(business_id,date)`);
  await run(`CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, business_id INTEGER NOT NULL, user_id INTEGER NOT NULL, rating INTEGER NOT NULL, quality INTEGER, behaviour INTEGER, value INTEGER, accuracy INTEGER, cleanliness INTEGER, body TEXT NOT NULL, photo_url TEXT, verification TEXT DEFAULT 'UNVERIFIED', status TEXT DEFAULT 'VISIBLE', created_at TEXT NOT NULL, FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  await run(`CREATE TABLE IF NOT EXISTS review_responses (id INTEGER PRIMARY KEY AUTOINCREMENT, review_id INTEGER UNIQUE NOT NULL, business_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(review_id) REFERENCES reviews(id) ON DELETE CASCADE, FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE)`);
  await run(`CREATE TABLE IF NOT EXISTS business_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, business_id INTEGER NOT NULL, user_id INTEGER NOT NULL, image_url TEXT NOT NULL, caption TEXT DEFAULT '', status TEXT DEFAULT 'VISIBLE', created_at TEXT NOT NULL, FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  await run(`CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_user_id INTEGER, target_type TEXT NOT NULL, target_id INTEGER NOT NULL, reason TEXT NOT NULL, status TEXT DEFAULT 'OPEN', created_at TEXT NOT NULL, resolution TEXT)`);
  await run(`CREATE TABLE IF NOT EXISTS business_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, business_id INTEGER NOT NULL, user_id INTEGER NOT NULL, status TEXT DEFAULT 'PENDING', note TEXT DEFAULT '', created_at TEXT NOT NULL)`);
  await run(`CREATE TABLE IF NOT EXISTS saved_businesses (user_id INTEGER NOT NULL, business_id INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,business_id))`);
  await run(`CREATE TABLE IF NOT EXISTS saved_items (user_id INTEGER NOT NULL, item_id INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,item_id))`);
  await run(`CREATE TABLE IF NOT EXISTS search_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, query TEXT NOT NULL, business_id INTEGER, item_id INTEGER, created_at TEXT NOT NULL)`);
  await run(`CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, type TEXT DEFAULT 'INFO', read INTEGER DEFAULT 0, created_at TEXT NOT NULL)`);
  await run(`CREATE TABLE IF NOT EXISTS notification_preferences (user_id INTEGER PRIMARY KEY, saved_updates INTEGER DEFAULT 1, reviews INTEGER DEFAULT 1, demand INTEGER DEFAULT 1, inventory INTEGER DEFAULT 1, local_updates INTEGER DEFAULT 1)`);

  await ensureColumn('businesses','description',"TEXT DEFAULT ''");
  await ensureColumn('businesses','cover_image',"TEXT DEFAULT ''");
  await ensureColumn('businesses','service_area',"TEXT DEFAULT ''");
  await ensureColumn('businesses','max_service_radius',"REAL DEFAULT 0");
  await ensureColumn('businesses','home_visit',"INTEGER DEFAULT 0");
  await ensureColumn('businesses','visit_charge',"REAL DEFAULT 0");
  await ensureColumn('businesses','emergency_service',"INTEGER DEFAULT 0");
  await ensureColumn('businesses','appointment_required',"INTEGER DEFAULT 0");
  await ensureColumn('businesses','profile_updated_at',"TEXT");
  await ensureColumn('businesses','latitude',"REAL");
  await ensureColumn('businesses','longitude',"REAL");
  await run("UPDATE businesses SET profile_updated_at = COALESCE(profile_updated_at, ?) WHERE profile_updated_at IS NULL", [now()]);
  await ensureColumn('businesses','verification_status',"TEXT DEFAULT 'UNCLAIMED'");
  await ensureColumn('businesses','profile_completeness',"INTEGER DEFAULT 60");
  await ensureColumn('items','updated_at',"TEXT");
  await ensureColumn('items','quantity',"INTEGER DEFAULT 0");
  await run("UPDATE items SET quantity = CASE WHEN quantity IS NULL OR quantity < 0 OR (quantity=0 AND status<>'OUT_OF_STOCK') THEN CASE status WHEN 'LOW_STOCK' THEN 4 WHEN 'OUT_OF_STOCK' THEN 0 WHEN 'MEDIUM_STOCK' THEN 8 ELSE 10 END ELSE quantity END");
  await run("UPDATE items SET updated_at = COALESCE(updated_at, ?) WHERE updated_at IS NULL", [now()]);
  await ensureColumn('items','price_type',"TEXT DEFAULT 'FIXED'");
  await ensureColumn('items','price_min',"REAL");
  await ensureColumn('items','price_max',"REAL");
  await ensureColumn('items','category_attributes',"TEXT DEFAULT '{}'");

  await seed();
}

const baseBusinesses = [
  ['Sharma Pustak & Stationery','Books & Stationery','+91 98260 11223','Near Bus Stand, Bada Bazaar',0.8,4.7,'Family stationery and school books store.',1],
  ['Raj Hair Studio','Beauty & Barber','+91 94251 99887','Shop 4, Panchayat Market',1.1,4.8,'Modern cuts, beard grooming and scalp care.',1],
  ['Kisan Agro & Machinery Spares','Agriculture & Tools','+91 97555 43210','Mandi Gate Bypass Road',2.3,4.5,'Farm machinery spares and repair supplies.',0],
  ['Mehta Grocery Mart','Grocery','+91 90000 11001','Jawahar Road, Indore',1.7,4.6,'Daily groceries, packaged foods and household essentials.',1],
  ['Needle & Thread Tailors','Tailor','+91 90000 11002','Rau Main Road',3.2,4.7,'Stitching, alterations and uniform tailoring.',1],
  ['City Mobile Care','Mobile Repair','+91 90000 11003','Rajwada Service Lane',2.0,4.4,'Phone repair, accessories and screen replacement.',1],
  ['Maa Durga Bakery','Bakery','+91 90000 11004','Saket Nagar Market',2.8,4.6,'Fresh bread, cakes and snacks.',1],
  ['Patel Hardware & Electricals','Hardware','+91 90000 11005','Khajrana Main Market',4.1,4.3,'Hardware, switches, wires and plumbing essentials.',1],
  ['Bright Minds Book House','Book Shop','+91 90000 11006','Vijay Nagar',5.2,4.8,'School books, competitive exam guides and stationery.',1],
  ['HomeFix Electrician','Home Services','+91 90000 11007','Serves Indore South',4.5,4.7,'Electrician with home visits and emergency service.',1],
  ['QuickFlow Plumbing','Home Services','+91 90000 11008','Serves Vijay Nagar, Scheme 54 & Palasia',3.6,4.6,'Plumber for leaks, taps, pipes, fittings and emergency water issues.',1],
  ['WoodCraft Carpenter','Home Services','+91 90000 11009','Serves Rau, Rajendra Nagar & Rau Circle',5.1,4.5,'Carpenter for furniture repair, doors, shelves and custom woodwork.',1],
  ['CoolCare AC & Appliance','Home Services','+91 90000 11010','Serves Vijay Nagar, Bengali Square & Nipania',4.8,4.7,'AC servicing, washing machine and refrigerator repair at home.',1],
  ['SafeNest Pest Control','Home Services','+91 90000 11011','Serves Indore city within 12 km',6.2,4.6,'Home pest control for cockroaches, ants, termites and mosquitoes.',1],
  ['PureDrop RO Service','Home Services','+91 90000 11012','Serves Palasia, Geeta Bhawan & Annapurna',3.9,4.4,'RO purifier service, filter replacement and water purifier repair.',1],
  ['SparkWash Home Cleaning','Home Services','+91 90000 11013','Serves Indore city within 10 km',5.7,4.8,'Deep cleaning, bathroom cleaning, kitchen cleaning and move-in cleaning.',1],
  ['SecureDoor Locksmith','Home Services','+91 90000 11014','Serves central Indore within 8 km',4.2,4.5,'Lock repair, key duplication, door lock installation and emergency lockout help.',1],
  ['Fresh Basket Mini Mart','Grocery','+91 90000 11015','Annapurna Main Road',2.4,4.5,'Neighbourhood grocery shop for snacks, breakfast items, staples and daily essentials.',1],
  ['Sunrise Dairy & Sweets','Dairy & Sweets','+91 90000 11016','Geeta Bhawan Market',2.1,4.6,'Milk, curd, paneer, sweets and fresh dairy products.',1],
  ['Green Leaf Fruits & Vegetables','Fruits & Vegetables','+91 90000 11017','Sudama Nagar Vegetable Market',1.9,4.4,'Seasonal fruits, fresh vegetables and everyday produce.',1],
  ['Metro Footwear Corner','Footwear','+91 90000 11018','Palasia Square Shopping Lane',3.0,4.3,'Affordable sandals, slippers, school shoes and everyday footwear.',1],
  ['A1 Home Needs','Household & Kitchen','+91 90000 11019','Scheme 54 Local Market',3.7,4.5,'Kitchenware, cleaning supplies, storage boxes and household essentials.',1],
  ['Pixel Phone Accessories','Mobile Accessories','+91 90000 11020','Chappan Market Service Road',2.6,4.4,'Phone cases, charging cables, screen guards and audio accessories.',1],
  ['Little Steps Kids Store','Kids & Toys','+91 90000 11021','Bhawarkua Main Road',4.0,4.6,'Children’s toys, school essentials, water bottles and small gifts.',1],
  ['Daily Dose Tea & Snacks','Tea & Snacks','+91 90000 11022','Bada Bazaar Corner',1.2,4.5,'Tea, coffee, packaged snacks and quick takeaway refreshments.',1]
];
const items = [
  [1,'Class 8 NCERT Mathematics Set',420,'PRODUCT','IN_STOCK','Complete English & Hindi medium books with guide','FIXED',420,420],
  [1,'Stainless Steel 1L Thermo Bottle',340,'PRODUCT','LOW_STOCK','Double insulated hot and cold bottle','FIXED',340,340],
  [1,'Hardbound Notebook Register (Set of 6)',210,'PRODUCT','IN_STOCK','Ruled pages for school and office','FIXED',210,210],
  [2,'Wolf Cut / Modern Layer Styling',250,'SERVICE','IN_STOCK','Trendy textured haircut with blow dry','FIXED',250,250],
  [2,'Classic Fade & Beard Sculpting',150,'SERVICE','IN_STOCK','Precision trim with hot towel service','FIXED',150,150],
  [2,'Ayurvedic Scalp Massage (20 Mins)',100,'SERVICE','IN_STOCK','Herbal cooling oil head massage','FIXED',100,100],
  [3,'Submersible Pump 1.5 HP Capacitor',480,'PRODUCT','IN_STOCK','Heavy duty copper wire motor capacitor','FIXED',480,480],
  [3,'Puncture Repair & Vulcanizing',80,'SERVICE','IN_STOCK','Cold patch vulcanizing for bike & tractor tubes','FIXED',80,80],
  [4,'Toor Dal 1kg',145,'PRODUCT','IN_STOCK','Fresh packaged toor dal','FIXED',145,145],
  [4,'Cooking Oil 1L',132,'PRODUCT','LOW_STOCK','Refined cooking oil','FIXED',132,132],
  [5,'School Uniform Stitching',300,'SERVICE','IN_STOCK','Shirt or trouser stitching, starting price','STARTING',300,null],
  [5,'Trouser Alteration',120,'SERVICE','IN_STOCK','Standard alteration service','FIXED',120,120],
  [6,'Phone Screen Replacement',1800,'SERVICE','IN_STOCK','Common Android models; confirm model first','FROM',1500,3500],
  [6,'USB-C Fast Charger',699,'PRODUCT','IN_STOCK','20W compatible charger','FIXED',699,699],
  [7,'Chocolate Truffle Cake 1/2kg',450,'PRODUCT','IN_STOCK','Pre-order for custom messages','FIXED',450,450],
  [8,'LED Bulb 9W',90,'PRODUCT','IN_STOCK','Energy efficient household bulb','FIXED',90,90],
  [9,'Class 8 Science Guide',280,'PRODUCT','IN_STOCK','Exam practice and chapter notes','FIXED',280,280],
  [9,'Atomic Habits',499,'PRODUCT','IN_STOCK','James Clear paperback edition; confirm availability before visiting','FIXED',499,499],
  [4,'Parle-G Biscuits 250g',30,'PRODUCT','IN_STOCK','Classic glucose biscuits family pack','FIXED',30,30],
  [4,'Good Day Butter Cookies 200g',40,'PRODUCT','IN_STOCK','Butter cookies packet','FIXED',40,40],
  [4,'Britannia Marie Gold 250g',35,'PRODUCT','IN_STOCK','Tea-time Marie biscuits','FIXED',35,35],
  [4,'Lay’s Classic Salted Chips  packet',20,'PRODUCT','IN_STOCK','Classic salted potato chips small pack','FIXED',20,20],
  [4,'Kurkure Masala Munch  pack',20,'PRODUCT','IN_STOCK','Spicy crunchy snack packet','FIXED',20,20],
  [7,'Chocolate Chip Cookies 200g',120,'PRODUCT','IN_STOCK','Fresh bakery cookies pack','FIXED',120,120],
  [7,'Nankhatai Biscuits 250g',90,'PRODUCT','IN_STOCK','Traditional bakery-style nankhatai','FIXED',90,90],
  [9,'Atomic Habits Paperback',479,'PRODUCT','IN_STOCK','Paperback edition; confirm edition and availability before visiting','FIXED',479,479],
  [1,'Classmate Single Line Notebook',55,'PRODUCT','IN_STOCK','Single notebook for school or office','FIXED',55,55],
  [4,'Amul Taaza Milk 500ml',29,'PRODUCT','IN_STOCK','Packaged toned milk','FIXED',29,29],
  [10,'Home Electrical Visit',250,'SERVICE','IN_STOCK','Standard visit fee before parts','ON_REQUEST',250,null],
  [11,'Tap & Pipe Repair',300,'SERVICE','IN_STOCK','Leak repair and tap replacement; parts extra','STARTING',300,null],
  [11,'Emergency Plumbing Visit',450,'SERVICE','IN_STOCK','Priority leak or water-line visit','FIXED',450,450],
  [12,'Furniture & Door Repair',400,'SERVICE','IN_STOCK','Furniture, hinges, doors and shelf repairs','STARTING',400,null],
  [12,'Custom Shelf Installation',700,'SERVICE','IN_STOCK','Basic wall shelf installation; material extra','STARTING',700,null],
  [13,'AC Service Visit',499,'SERVICE','IN_STOCK','Split/window AC cleaning and inspection','FIXED',499,499],
  [13,'Washing Machine Repair Visit',350,'SERVICE','IN_STOCK','Home diagnosis and repair visit; parts extra','STARTING',350,null],
  [14,'General Pest Control',799,'SERVICE','IN_STOCK','One standard home treatment','STARTING',799,1499],
  [14,'Termite Inspection',399,'SERVICE','IN_STOCK','Home inspection and treatment estimate','FIXED',399,399],
  [15,'RO Service & Filter Change',350,'SERVICE','IN_STOCK','RO maintenance and filter replacement visit','STARTING',350,null],
  [15,'RO Repair Visit',250,'SERVICE','IN_STOCK','Diagnosis and repair visit; parts extra','FIXED',250,250],
  [16,'Deep Home Cleaning',1299,'SERVICE','IN_STOCK','Standard 1BHK deep-cleaning visit','STARTING',1299,2499],
  [16,'Bathroom Cleaning',499,'SERVICE','IN_STOCK','Single bathroom deep cleaning','FIXED',499,499],
  [17,'Emergency Lockout Visit',350,'SERVICE','IN_STOCK','Door lockout assistance; lock parts extra','FIXED',350,350],
  [17,'Lock Installation',500,'SERVICE','IN_STOCK','Standard lock installation service','STARTING',500,null]
];
const schedules = {
  'Sharma Pustak & Stationery': [['Monday','09:00','20:00'],['Tuesday','09:00','20:00'],['Wednesday','10:00','19:00'],['Thursday','09:00','20:30'],['Friday','09:00','20:30'],['Saturday','09:00','21:00'],['Sunday','10:00','14:00']],
  'Raj Hair Studio': [['Monday','10:00','20:30'],['Tuesday','10:00','20:30'],['Wednesday','12:00','20:30'],['Thursday','10:00','20:30'],['Friday','10:00','21:00'],['Saturday','09:00','21:00'],['Sunday','10:00','16:00']],
  'Kisan Agro & Machinery Spares': [['Monday','08:00','18:00'],['Tuesday','08:00','18:00'],['Wednesday','08:00','18:00'],['Thursday','08:00','18:00'],['Friday','08:00','18:30'],['Saturday','08:00','17:00'],['Sunday',null,null]],
  'Mehta Grocery Mart': [['Monday','07:00','22:00'],['Tuesday','07:00','22:00'],['Wednesday','07:00','22:00'],['Thursday','07:00','22:00'],['Friday','07:00','22:00'],['Saturday','07:00','22:30'],['Sunday','08:00','20:00']],
  'Needle & Thread Tailors': [['Monday','10:30','19:30'],['Tuesday','10:30','19:30'],['Wednesday',null,null],['Thursday','10:30','19:30'],['Friday','10:30','19:30'],['Saturday','10:00','20:00'],['Sunday','11:00','15:00']],
  'City Mobile Care': [['Monday','10:00','20:00'],['Tuesday','10:00','20:00'],['Wednesday','10:00','20:00'],['Thursday','10:00','20:00'],['Friday','10:00','20:00'],['Saturday','10:00','20:30'],['Sunday','11:00','16:00']],
  'Maa Durga Bakery': [['Monday','06:30','21:00'],['Tuesday','06:30','21:00'],['Wednesday','06:30','21:00'],['Thursday','06:30','21:00'],['Friday','06:30','21:30'],['Saturday','06:30','22:00'],['Sunday','07:00','20:00']],
  'Patel Hardware & Electricals': [['Monday','09:30','19:00'],['Tuesday','09:30','19:00'],['Wednesday','09:30','19:00'],['Thursday','09:30','19:00'],['Friday','09:30','19:30'],['Saturday','09:30','18:00'],['Sunday',null,null]],
  'Bright Minds Book House': [['Monday','10:00','20:30'],['Tuesday','10:00','20:30'],['Wednesday','10:00','20:30'],['Thursday','10:00','20:30'],['Friday','10:00','21:00'],['Saturday','09:30','21:00'],['Sunday','10:00','18:00']],
  'HomeFix Electrician': [['Monday','08:00','21:00'],['Tuesday','08:00','21:00'],['Wednesday','08:00','21:00'],['Thursday','08:00','21:00'],['Friday','08:00','21:00'],['Saturday','08:00','22:00'],['Sunday','09:00','20:00']],
  'QuickFlow Plumbing': [['Monday','07:00','21:00'],['Tuesday','07:00','21:00'],['Wednesday','07:00','21:00'],['Thursday','07:00','21:00'],['Friday','07:00','21:00'],['Saturday','07:00','22:00'],['Sunday','08:00','18:00']],
  'WoodCraft Carpenter': [['Monday','09:00','19:00'],['Tuesday','09:00','19:00'],['Wednesday','09:00','19:00'],['Thursday','09:00','19:00'],['Friday','09:00','19:00'],['Saturday','09:00','18:00'],['Sunday',null,null]],
  'CoolCare AC & Appliance': [['Monday','08:00','20:00'],['Tuesday','08:00','20:00'],['Wednesday','08:00','20:00'],['Thursday','08:00','20:00'],['Friday','08:00','20:00'],['Saturday','08:00','21:00'],['Sunday','09:00','17:00']],
  'SafeNest Pest Control': [['Monday','08:00','20:00'],['Tuesday','08:00','20:00'],['Wednesday','08:00','20:00'],['Thursday','08:00','20:00'],['Friday','08:00','20:00'],['Saturday','08:00','20:00'],['Sunday','09:00','16:00']],
  'PureDrop RO Service': [['Monday','09:00','19:00'],['Tuesday','09:00','19:00'],['Wednesday','09:00','19:00'],['Thursday','09:00','19:00'],['Friday','09:00','19:00'],['Saturday','09:00','19:00'],['Sunday','10:00','15:00']],
  'SparkWash Home Cleaning': [['Monday','07:00','20:00'],['Tuesday','07:00','20:00'],['Wednesday','07:00','20:00'],['Thursday','07:00','20:00'],['Friday','07:00','20:00'],['Saturday','07:00','21:00'],['Sunday','08:00','18:00']],
  'SecureDoor Locksmith': [['Monday','00:00','23:59'],['Tuesday','00:00','23:59'],['Wednesday','00:00','23:59'],['Thursday','00:00','23:59'],['Friday','00:00','23:59'],['Saturday','00:00','23:59'],['Sunday','00:00','23:59']],
  'Fresh Basket Mini Mart': [['Monday','07:00','21:30'],['Tuesday','07:00','21:30'],['Wednesday','07:00','21:30'],['Thursday','07:00','21:30'],['Friday','07:00','21:30'],['Saturday','07:00','22:00'],['Sunday','08:00','20:00']],
  'Sunrise Dairy & Sweets': [['Monday','06:30','21:00'],['Tuesday','06:30','21:00'],['Wednesday','06:30','21:00'],['Thursday','06:30','21:00'],['Friday','06:30','21:30'],['Saturday','06:30','21:30'],['Sunday','07:00','20:00']],
  'Green Leaf Fruits & Vegetables': [['Monday','06:00','20:00'],['Tuesday','06:00','20:00'],['Wednesday','06:00','20:00'],['Thursday','06:00','20:00'],['Friday','06:00','20:00'],['Saturday','06:00','20:00'],['Sunday','06:30','14:00']],
  'Metro Footwear Corner': [['Monday','10:00','20:30'],['Tuesday','10:00','20:30'],['Wednesday','10:00','20:30'],['Thursday','10:00','20:30'],['Friday','10:00','21:00'],['Saturday','10:00','21:00'],['Sunday','11:00','18:00']],
  'A1 Home Needs': [['Monday','09:00','20:30'],['Tuesday','09:00','20:30'],['Wednesday','09:00','20:30'],['Thursday','09:00','20:30'],['Friday','09:00','20:30'],['Saturday','09:00','21:00'],['Sunday','10:00','17:00']],
  'Pixel Phone Accessories': [['Monday','10:00','21:00'],['Tuesday','10:00','21:00'],['Wednesday','10:00','21:00'],['Thursday','10:00','21:00'],['Friday','10:00','21:00'],['Saturday','10:00','21:30'],['Sunday','11:00','18:00']],
  'Little Steps Kids Store': [['Monday','10:00','20:00'],['Tuesday','10:00','20:00'],['Wednesday','10:00','20:00'],['Thursday','10:00','20:00'],['Friday','10:00','20:30'],['Saturday','10:00','21:00'],['Sunday','11:00','18:00']],
  'Daily Dose Tea & Snacks': [['Monday','07:00','22:00'],['Tuesday','07:00','22:00'],['Wednesday','07:00','22:00'],['Thursday','07:00','22:00'],['Friday','07:00','22:00'],['Saturday','07:00','22:30'],['Sunday','08:00','21:00']]
};

async function seed() {
  // Preserve existing records, then add only missing demo/catalog data.
  for (const b of baseBusinesses) {
    const existing = await get(`SELECT id FROM businesses WHERE name=?`, [b[0]]);
    if (!existing) {
      const r = await run(`INSERT INTO businesses(name,category,phone,address,distance,rating,description,verified,verification_status,profile_completeness,profile_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [...b, 'UNCLAIMED', 72, now()]);
      for (const s of schedules[b[0]] || []) await run(`INSERT OR IGNORE INTO business_hours(business_id,day,is_closed,open_time,close_time,periods_json) VALUES(?,?,?,?,?,?)`, [r.lastID,s[0],s[1]?0:1,s[1],s[2],JSON.stringify(s[1]?[{open:s[1],close:s[2]}]:[])]);
    }
  }
  for (const b of baseBusinesses) {
    const row = await get(`SELECT id FROM businesses WHERE name=?`, [b[0]]);
    const hcount = await get(`SELECT COUNT(*) c FROM business_hours WHERE business_id=?`, [row.id]);
    if (!hcount.c) for (const s of schedules[b[0]] || []) await run(`INSERT OR IGNORE INTO business_hours(business_id,day,is_closed,open_time,close_time,periods_json) VALUES(?,?,?,?,?,?)`, [row.id,s[0],s[1]?0:1,s[1],s[2],JSON.stringify(s[1]?[{open:s[1],close:s[2]}]:[])]);
  }
  for (const it of items) {
    const [bid,name] = [it[0],it[1]];
    const existing = await get(`SELECT id FROM items WHERE business_id=? AND name=?`, [bid,name]);
    if (!existing) await run(`INSERT INTO items(business_id,name,price,type,status,description,price_type,price_min,price_max,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, [...it, now()]);
  }
  // Extra demo catalog uses business names, not hard-coded IDs, so it remains safe
  // if an existing database has different auto-increment IDs.
  const extraDemoItems = [
    ['Fresh Basket Mini Mart','Aashirvaad Atta 5kg',285,'Wheat flour 5 kg pack'],
    ['Fresh Basket Mini Mart','Tata Salt 1kg',28,'Everyday iodised salt'],
    ['Fresh Basket Mini Mart','Maggi 2-Minute Noodles  pack of 4',56,'Instant noodles multipack'],
    ['Fresh Basket Mini Mart','Dairy Milk Chocolate  Silk 60g',80,'Chocolate bar'],
    ['Sunrise Dairy & Sweets','Fresh Cow Milk 500ml',32,'Fresh milk pouch'],
    ['Sunrise Dairy & Sweets','Paneer 200g',90,'Fresh paneer pack'],
    ['Sunrise Dairy & Sweets','Plain Curd 400g',45,'Fresh set curd tub'],
    ['Sunrise Dairy & Sweets','Gulab Jamun 250g',110,'Ready-to-serve sweets'],
    ['Green Leaf Fruits & Vegetables','Banana 1 dozen',60,'Seasonal bananas'],
    ['Green Leaf Fruits & Vegetables','Tomato 1kg',40,'Fresh tomatoes'],
    ['Green Leaf Fruits & Vegetables','Potato 1kg',32,'Everyday potatoes'],
    ['Green Leaf Fruits & Vegetables','Apple 1kg',160,'Seasonal apples'],
    ['Metro Footwear Corner','Everyday Rubber Slippers',149,'Lightweight daily-use slippers'],
    ['Metro Footwear Corner','School Shoes',399,'Black school shoes'],
    ['Metro Footwear Corner','Casual Sandals',349,'Everyday casual sandals'],
    ['A1 Home Needs','Stainless Steel Lunch Box',249,'Compact lunch box'],
    ['A1 Home Needs','Microfiber Cleaning Cloth Set',99,'Pack of three cloths'],
    ['A1 Home Needs','Plastic Storage Container Set',299,'Kitchen storage set'],
    ['Pixel Phone Accessories','USB-C Charging Cable',149,'1 metre charging cable'],
    ['Pixel Phone Accessories','Tempered Glass Screen Guard',99,'Screen protector for common phone sizes'],
    ['Pixel Phone Accessories','Clear Phone Back Cover',179,'Transparent protective case'],
    ['Little Steps Kids Store','Building Blocks Starter Set',249,'Colourful kids building blocks'],
    ['Little Steps Kids Store','Kids Water Bottle 750ml',199,'Reusable school water bottle'],
    ['Little Steps Kids Store','Colour Pencil Set 12 Shades',75,'Colouring pencil set'],
    ['Daily Dose Tea & Snacks','Masala Chai 100g',85,'Packaged tea blend'],
    ['Daily Dose Tea & Snacks','Roasted Peanut Snack 200g',55,'Roasted savoury snack pack'],
    ['Daily Dose Tea & Snacks','Instant Coffee 50g',125,'Instant coffee jar']
  ];
  for (const [businessName,name,price,description] of extraDemoItems) {
    const business = await get(`SELECT id FROM businesses WHERE name=?`, [businessName]);
    if (!business) continue;
    const existing = await get(`SELECT id FROM items WHERE business_id=? AND name=?`, [business.id,name]);
    if (!existing) await run(`INSERT INTO items(business_id,name,price,type,status,description,price_type,price_min,price_max,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, [business.id,name,price,'PRODUCT','IN_STOCK',description,'FIXED',price,price,now()]);
  }
  const serviceMeta = {
    'HomeFix Electrician': {radius:10, area:'Indore South, Bengali Square, Palasia', charge:250, emergency:1, appointment:0},
    'QuickFlow Plumbing': {radius:8, area:'Vijay Nagar, Scheme 54, Palasia, Geeta Bhawan', charge:300, emergency:1, appointment:0},
    'WoodCraft Carpenter': {radius:7, area:'Rau, Rajendra Nagar, Rau Circle, Rajwada', charge:400, emergency:0, appointment:1},
    'CoolCare AC & Appliance': {radius:9, area:'Vijay Nagar, Bengali Square, Nipania, Palasia', charge:499, emergency:0, appointment:1},
    'SafeNest Pest Control': {radius:12, area:'Indore city and nearby residential areas', charge:799, emergency:0, appointment:1},
    'PureDrop RO Service': {radius:8, area:'Palasia, Geeta Bhawan, Annapurna, Sudama Nagar', charge:250, emergency:0, appointment:1},
    'SparkWash Home Cleaning': {radius:10, area:'Indore city within 10 km', charge:499, emergency:0, appointment:1},
    'SecureDoor Locksmith': {radius:8, area:'Central Indore and nearby areas', charge:350, emergency:1, appointment:0}
  };
  for (const [name,m] of Object.entries(serviceMeta)) {
    await run(`UPDATE businesses SET service_area=?,max_service_radius=?,home_visit=1,visit_charge=?,emergency_service=?,appointment_required=? WHERE name=?`,[m.area,m.radius,m.charge,m.emergency,m.appointment,name]);
  }
  const demoCoords = {
    'Sharma Pustak & Stationery':[22.7196,75.8577],
    'Raj Hair Studio':[22.7245,75.8782],
    'Mehta Grocery Mart':[22.7350,75.8648],
    'City Mobile Care':[22.7108,75.8521],
    'Kisan Agro & Machinery Spares':[22.6964,75.8269],
    'Maa Durga Bakery':[22.7465,75.8921],
    'Needle & Thread Tailors':[22.7016,75.8355],
    'Patel Hardware & Electricals':[22.7138,75.9004],
    'HomeFix Electrician':[22.7115,75.8705],
    'Bright Minds Book House':[22.7571,75.8759],
    'QuickFlow Plumbing':[22.7337,75.9112],
    'WoodCraft Carpenter':[22.6819,75.8067],
    'CoolCare AC & Appliance':[22.7448,75.9001],
    'SafeNest Pest Control':[22.7262,75.8460],
    'PureDrop RO Service':[22.7162,75.8419],
    'SparkWash Home Cleaning':[22.7484,75.8668],
    'SecureDoor Locksmith':[22.7057,75.8796]
  };
  for (const [name,coords] of Object.entries(demoCoords)) await run(`UPDATE businesses SET latitude=?,longitude=? WHERE name=?`,[coords[0],coords[1],name]);
  await run(`UPDATE items SET quantity=10 WHERE type='SERVICE' AND (quantity IS NULL OR quantity=0)`);

  async function ensureUser(name,email,password,role,location) {
    let u=await get(`SELECT * FROM users WHERE lower(email)=lower(?)`,[email]);
    if(!u){const r=await run(`INSERT INTO users(name,email,password_hash,role,location,created_at) VALUES(?,?,?,?,?,?)`,[name,email,hashPassword(password),role,location,now()]);u=await get(`SELECT * FROM users WHERE id=?`,[r.lastID]);}
    await run(`INSERT OR IGNORE INTO notification_preferences(user_id) VALUES(?)`,[u.id]);
    return u;
  }
  const customer=await ensureUser('Demo Customer','demo@gramsetu.app','Demo@12345','CUSTOMER','Bada Bazaar, Indore');
  const owner=await ensureUser('Market Hub Demo Owner','business@gramsetu.app','Business@12345','BUSINESS_OWNER','Bada Bazaar, Indore');
  await ensureUser('Market Hub Admin','admin@gramsetu.app','Admin@12345','ADMIN','Indore');
  await run(`INSERT OR IGNORE INTO business_owners(business_id,user_id,claim_status) VALUES(1,?,'VERIFIED')`,[owner.id]);
  await run(`UPDATE businesses SET verification_status='VERIFIED',verified=1,profile_completeness=96 WHERE id=1`);

  const reviewCount=await get(`SELECT COUNT(*) c FROM reviews`);
  if(!reviewCount.c){
    const reviewData=[[1,customer.id,5,5,5,4,5,5,'Books were ready when I arrived and the pricing matched the listing.'],[1,customer.id,4,4,5,4,4,4,'Helpful staff and good school-book selection.'],[2,customer.id,5,5,5,5,5,5,'The haircut matched the reference and the shop was friendly.'],[3,customer.id,4,4,4,4,4,4,'Found the capacitor I needed; staff helped identify the part.']];
    for(const r of reviewData) await run(`INSERT INTO reviews(business_id,user_id,rating,quality,behaviour,value,accuracy,cleanliness,body,verification,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,[...r,'UNVERIFIED','VISIBLE']);
    for(const [bid] of [[1],[2],[3]]){const stats=await get(`SELECT AVG(rating) avg,COUNT(*) c FROM reviews WHERE business_id=?`,[bid]);await run(`UPDATE businesses SET rating=?,reviews_count=? WHERE id=?`,[Number(stats.avg||0).toFixed(1),stats.c,bid]);}
  }
  await run(`INSERT OR IGNORE INTO saved_businesses(user_id,business_id,created_at) VALUES(?,?,?)`, [customer.id,1,now()]);
  const firstItem=await get(`SELECT id FROM items WHERE business_id=1 ORDER BY id LIMIT 1`); if(firstItem) await run(`INSERT OR IGNORE INTO saved_items(user_id,item_id,created_at) VALUES(?,?,?)`,[customer.id,firstItem.id,now()]);
  const n=await get(`SELECT COUNT(*) c FROM notifications WHERE user_id=?`,[customer.id]);
  if(!n.c) await run(`INSERT INTO notifications(user_id,title,body,type,created_at) VALUES(?,?,?,?,?)`,[customer.id,'Welcome to Market Hub','Your saved local businesses and products will appear here.','INFO',now()]);
  const dcount=await get(`SELECT COUNT(*) c FROM demand_insights`);
  if(!dcount.c){const ds=[['Thermo Flask Bottles (1L)','58%',41,'Only 1 nearby shop has low stock.'],['Class 8 Mathematics Book Set','44%',67,'High search activity this week.']];for(const d of ds) await run(`INSERT INTO demand_insights(item,increase,searches,action,period_start,period_end) VALUES(?,?,?,?,?,?)`,[...d,new Date(Date.now()-6*864e5).toISOString(),now()]);}
  const ev=await get(`SELECT COUNT(*) c FROM search_events`); if(!ev.c) for(const q of ['class 8 books','thermo bottle','wolf cut','capacitor','bike puncture','red school bag']) await run(`INSERT INTO search_events(user_id,query,created_at) VALUES(?,?,?)`,[customer.id,q,now()]);
}
async function currentHours(businessId, date = new Date()) {
  const todayKey = new Intl.DateTimeFormat('en-CA', {timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
  const special = await get(`SELECT * FROM special_hours WHERE business_id=? AND date=?`,[businessId,todayKey]);
  if (special?.is_closed) return {open:false,closesAt:null,nextOpen:null,label:`Closed today${special.note?` · ${special.note}`:''}`,closedToday:true,specialNote:special.note||''};
  const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const day=dayName(date); const idx=days.indexOf(day); const current=mins(timeInIndia(date));
  const row=await get(`SELECT * FROM business_hours WHERE business_id=? AND day=?`,[businessId,day]);
  if(row && !row.is_closed){
    const open=mins(row.open_time),close=mins(row.close_time); const overnight=close<open;
    const isOpen=overnight ? (current>=open || current<close) : (current>=open && current<close);
    if(isOpen){ const closeMinutes=overnight&&current>=open ? close+1440 : close; const nowMinutes=overnight&&current<close ? current+1440 : current; const soon=closeMinutes-nowMinutes<=60; return {open:true,closesAt:formatTime(row.close_time),nextOpen:null,label:soon?`Open now · closes soon at ${formatTime(row.close_time)}`:`Open now · closes at ${formatTime(row.close_time)}`}; }
    return {open:false,closesAt:null,nextOpen:formatTime(row.open_time),label:`Closed · opens at ${formatTime(row.open_time)}`};
  }
  // If today's schedule is closed, or if a previous-day schedule runs past midnight, inspect it.
  const prev=days[(idx+6)%7]; const prevRow=await get(`SELECT * FROM business_hours WHERE business_id=? AND day=?`,[businessId,prev]);
  if(prevRow && !prevRow.is_closed && mins(prevRow.close_time)<mins(prevRow.open_time) && current<mins(prevRow.close_time)){ const soon=mins(prevRow.close_time)-current<=60; return {open:true,closesAt:formatTime(prevRow.close_time),nextOpen:null,label:soon?`Open now · closes soon at ${formatTime(prevRow.close_time)}`:`Open now · closes at ${formatTime(prevRow.close_time)}`}; }
  for(let offset=1;offset<=7;offset++){const next=days[(idx+offset)%7];const n=await get(`SELECT * FROM business_hours WHERE business_id=? AND day=?`,[businessId,next]);if(n&&!n.is_closed)return {open:false,closesAt:null,nextOpen:`${offset===1?'tomorrow':next} at ${formatTime(n.open_time)}`,label:`Closed today · opens ${offset===1?'tomorrow':next} at ${formatTime(n.open_time)}`};}
  return {open:false,closesAt:null,nextOpen:null,label:'Closed'};
}
async function enrichBusiness(b) {
  const hours = await currentHours(b.id);
  const items = await all(`SELECT id,name,price,type,status,quantity,description,price_type,price_min,price_max,updated_at,category_attributes FROM items WHERE business_id=? ORDER BY id`, [b.id]);
  return {...b,is_open:hours.open?1:0,closes_at:hours.closesAt||'',status_label:hours.label,next_open:hours.nextOpen,items:items.map(i=>({...i,status:i.quantity<=0?'OUT_OF_STOCK':i.quantity<5?'LOW_STOCK':i.status==='OUT_OF_STOCK'?'OUT_OF_STOCK':i.quantity<10?'MEDIUM_STOCK':'IN_STOCK',availability_verified:Date.now()-new Date(i.updated_at).getTime() < 3*864e5}))};
}
async function getBusiness(id) { const b=await get(`SELECT * FROM businesses WHERE id=?`,[id]); return b?enrichBusiness(b):null; }
async function getBusinessPhotos(id) { return all(`SELECT p.id,p.business_id,p.user_id,p.image_url,p.caption,p.status,p.created_at,u.name uploader,u.role uploader_role FROM business_photos p JOIN users u ON u.id=p.user_id WHERE p.business_id=? AND p.status='VISIBLE' ORDER BY p.created_at DESC`,[id]); }

async function auth(req,res,next) {
  try {
    const raw=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(!raw) return res.status(401).json({error:'Authentication required'});
    const s=await get(`SELECT s.*,u.id user_id,u.name,u.email,u.role,u.location,u.avatar FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?`,[raw,now()]);
    if(!s) return res.status(401).json({error:'Session expired'});
    req.user={id:s.user_id,name:s.name,email:s.email,role:s.role,location:s.location,avatar:s.avatar,token:raw}; next();
  } catch(e){res.status(500).json({error:e.message});}
}
function requireRole(...roles){return (req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:'Not authorized'});}
async function ownerFor(req,businessId){
  const owner=await get(`SELECT * FROM business_owners WHERE business_id=? AND user_id=? AND claim_status='VERIFIED'`,[businessId,req.user.id]);
  return !!owner;
}

app.get('/api/health',(req,res)=>res.json({ok:true,name:'Market Hub'}));
app.post('/api/auth/login',async(req,res)=>{try{const {email,password}=req.body;const u=await get(`SELECT * FROM users WHERE lower(email)=lower(?)`,[String(email||'').trim()]);if(!u||!verifyPassword(String(password||''),u.password_hash))return res.status(401).json({error:'Invalid email or password'});const t=token();await run(`INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)`,[t,u.id,new Date(Date.now()+7*864e5).toISOString()]);res.json({token:t,user:{id:u.id,name:u.name,email:u.email,role:u.role,location:u.location,avatar:u.avatar}});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/auth/logout',auth,async(req,res)=>{await run(`DELETE FROM sessions WHERE token=?`,[req.user.token]);res.json({ok:true});});
app.get('/api/auth/me',auth,(req,res)=>res.json({user:req.user}));
app.post('/api/auth/register',async(req,res)=>{try{const {name,email,password,role='CUSTOMER',location=''}=req.body;if(!name||!email||!password||password.length<8)return res.status(400).json({error:'Name, email and an 8+ character password are required'});const safeRole=role==='BUSINESS_OWNER'?'BUSINESS_OWNER':'CUSTOMER';const r=await run(`INSERT INTO users(name,email,password_hash,role,location,created_at) VALUES(?,?,?,?,?,?)`,[name,email.toLowerCase(),hashPassword(password),safeRole,location,now()]);await run(`INSERT INTO notification_preferences(user_id) VALUES(?)`,[r.lastID]);res.json({id:r.lastID});}catch(e){res.status(400).json({error:e.message.includes('UNIQUE')?'Email already registered':e.message});}});

app.get('/api/businesses',async(req,res)=>{try{const q=String(req.query.q||'').trim().toLowerCase();const category=String(req.query.category||'').trim();const userLat=Number(req.query.lat),userLng=Number(req.query.lng);const hasUserLocation=Number.isFinite(userLat)&&Number.isFinite(userLng);let rows=await Promise.all((await all(`SELECT * FROM businesses ORDER BY rating DESC,distance ASC`)).map(enrichBusiness));if(hasUserLocation){rows=rows.map(b=>({...b,distance:b.latitude!=null&&b.longitude!=null?Number(haversineKm(userLat,userLng,b.latitude,b.longitude).toFixed(1)):Number(b.distance||999)}));}if(q){const words=q.split(/\s+/).filter(Boolean);rows=rows.filter(b=>{const hay=`${b.name} ${b.category} ${b.description} ${b.address} ${b.items.map(i=>i.name+' '+(i.description||'')).join(' ')}`.toLowerCase();return words.every(w=>hay.includes(w)) || hay.includes(q) || widen(q,b.category);});}if(category) rows=rows.filter(b=>b.category===category);rows.sort((a,b)=>Number(b.is_open)-Number(a.is_open)||distanceRank(a.distance)-distanceRank(b.distance)||Number(b.rating)-Number(a.rating));res.json(rows);}catch(e){res.status(500).json({error:e.message});}});
function widen(q,cat){const synonyms={barber:['hair','haircut','salon'],mechanic:['bike','puncture','repair'],books:['book','books','ncert'],stationery:['notebook','pen'],electrician:['electrical','electric'],tailor:['stitching','alteration']};return Object.entries(synonyms).some(([k,vals])=>q.includes(k)&&vals.some(v=>cat.toLowerCase().includes(v)));}
app.get('/api/businesses/:id',async(req,res)=>{try{const b=await getBusiness(req.params.id);if(!b)return res.status(404).json({error:'Business not found'});const reviews=await all(`SELECT r.*,u.name reviewer FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.business_id=? AND r.status='VISIBLE' ORDER BY r.created_at DESC`,[b.id]);const responses=await all(`SELECT * FROM review_responses WHERE business_id=?`,[b.id]);res.json({...b,reviews:reviews.map(r=>({...r,response:responses.find(x=>x.review_id===r.id)?.body||null})),photos:await getBusinessPhotos(b.id),hours:await all(`SELECT * FROM business_hours WHERE business_id=? ORDER BY CASE day WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 ELSE 7 END`,[b.id])});}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/search-events',auth,async(req,res)=>{try{const {query,business_id,item_id}=req.body;if(query)await run(`INSERT INTO search_events(user_id,query,business_id,item_id,created_at) VALUES(?,?,?,?,?)`,[req.user.id,query,business_id||null,item_id||null,now()]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/demand',auth,requireRole('BUSINESS_OWNER','ADMIN'),async(req,res)=>{try{const rows=await all(`SELECT * FROM demand_insights ORDER BY searches DESC`);res.json(rows.map(r=>({...r,source:'demo-seeded',comparison:'current 7-day period vs previous 7-day period'})));}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/dashboard/demand',auth,requireRole('BUSINESS_OWNER','ADMIN'),async(req,res)=>{try{const business=await get(`SELECT business_id FROM business_owners WHERE user_id=? AND claim_status='VERIFIED'`,[req.user.id]);const bid=business?.business_id;const cutoff=new Date(Date.now()-7*864e5).toISOString();const prev=new Date(Date.now()-14*864e5).toISOString();const rows=await all(`SELECT query,COUNT(*) c FROM search_events WHERE created_at>=? GROUP BY lower(query) ORDER BY c DESC LIMIT 20`,[cutoff]);const previous=await all(`SELECT query,COUNT(*) c FROM search_events WHERE created_at>=? AND created_at<? GROUP BY lower(query)`,[prev,cutoff]);const prevMap=Object.fromEntries(previous.map(x=>[x.query.toLowerCase(),x.c]));const insights=rows.map(x=>{const p=prevMap[x.query.toLowerCase()]||0;return {query:x.query,searches:x.c,previous:p,increase:p?Math.round((x.c-p)/p*100):null,hasEnoughData:x.c>=5};}).filter(x=>x.hasEnoughData);res.json({business_id:bid,period:'7 days vs previous 7 days',insights,privacyThreshold:5,demoData:true});}catch(e){res.status(500).json({error:e.message});}});

app.patch('/api/items/:id/status',auth,requireRole('BUSINESS_OWNER','ADMIN'),async(req,res)=>{try{const item=await get(`SELECT * FROM items WHERE id=?`,[req.params.id]);if(!item)return res.status(404).json({error:'Item not found'});if(req.user.role==='BUSINESS_OWNER'&&!await ownerFor(req,item.business_id))return res.status(403).json({error:'You do not own this business'});if(!['IN_STOCK','MEDIUM_STOCK','LOW_STOCK','OUT_OF_STOCK'].includes(req.body.status))return res.status(400).json({error:'Invalid status'});await run(`UPDATE items SET status=?,updated_at=? WHERE id=?`,[req.body.status,now(),item.id]);res.json({success:true,updated_at:now()});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/items',auth,requireRole('BUSINESS_OWNER','ADMIN'),async(req,res)=>{try{const {business_id,name,price,type='PRODUCT',status='IN_STOCK',quantity=0,description='',price_type='FIXED',price_min,price_max,category_attributes={}}=req.body;if(!business_id||!name)return res.status(400).json({error:'Business and item name are required'});if(req.user.role==='BUSINESS_OWNER'&&!await ownerFor(req,business_id))return res.status(403).json({error:'You do not own this business'});const r=await run(`INSERT INTO items(business_id,name,price,type,status,quantity,description,price_type,price_min,price_max,category_attributes,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[business_id,name,price||null,type,Math.max(0,Number(quantity)||0)<1?'OUT_OF_STOCK':Math.max(0,Number(quantity)||0)<5?'LOW_STOCK':Math.max(0,Number(quantity)||0)<10?'MEDIUM_STOCK':'IN_STOCK',Math.max(0,Number(quantity)||0),description,price_type,price_min||null,price_max||null,JSON.stringify(category_attributes),now()]);res.json({id:r.lastID});}catch(e){res.status(500).json({error:e.message});}});
app.patch('/api/items/:id',auth,requireRole('BUSINESS_OWNER','ADMIN'),async(req,res)=>{try{const item=await get(`SELECT * FROM items WHERE id=?`,[req.params.id]);if(!item)return res.status(404).json({error:'Item not found'});if(req.user.role==='BUSINESS_OWNER'&&!await ownerFor(req,item.business_id))return res.status(403).json({error:'You do not own this business'});const allowed=['name','price','type','status','quantity','description','price_type','price_min','price_max','category_attributes'];const data={...item,...Object.fromEntries(allowed.filter(k=>req.body[k]!==undefined).map(k=>[k,req.body[k]]))};await run(`UPDATE items SET name=?,price=?,type=?,status=?,quantity=?,description=?,price_type=?,price_min=?,price_max=?,category_attributes=?,updated_at=? WHERE id=?`,[data.name,data.price,data.type,data.status,Math.max(0,Number(data.quantity)||0),data.description,data.price_type,data.price_min,data.price_max,typeof data.category_attributes==='string'?data.category_attributes:JSON.stringify(data.category_attributes),now(),item.id]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/business/me',auth,requireRole('BUSINESS_OWNER'),async(req,res)=>{try{const own=await get(`SELECT business_id FROM business_owners WHERE user_id=? AND claim_status='VERIFIED'`,[req.user.id]);if(!own)return res.status(404).json({error:'No verified business found'});const b=await getBusiness(own.business_id);const reviews=await all(`SELECT r.*,u.name reviewer FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.business_id=? AND r.status='VISIBLE' ORDER BY r.created_at DESC`,[b.id]);const responses=await all(`SELECT * FROM review_responses WHERE business_id=?`,[b.id]);const hours=await all(`SELECT * FROM business_hours WHERE business_id=? ORDER BY rowid`,[b.id]);res.json({...b,reviews:reviews.map(r=>({...r,response:responses.find(x=>x.review_id===r.id)?.body||null})),photos:await getBusinessPhotos(b.id),hours});}catch(e){res.status(500).json({error:e.message});}});
app.patch('/api/business/:id',auth,requireRole('BUSINESS_OWNER','ADMIN'),async(req,res)=>{try{if(req.user.role==='BUSINESS_OWNER'&&!await ownerFor(req,req.params.id))return res.status(403).json({error:'You do not own this business'});const b=await get(`SELECT * FROM businesses WHERE id=?`,[req.params.id]);if(!b)return res.status(404).json({error:'Business not found'});const fields=['name','category','phone','address','description','service_area','max_service_radius','home_visit','visit_charge','emergency_service','appointment_required','latitude','longitude'];const vals=fields.map(k=>req.body[k]!==undefined?req.body[k]:b[k]);const completeness=Math.round(fields.filter((k,i)=>String(vals[i]??'').trim()!=='').length/fields.length*100);await run(`UPDATE businesses SET name=?,category=?,phone=?,address=?,description=?,service_area=?,max_service_radius=?,home_visit=?,visit_charge=?,emergency_service=?,appointment_required=?,latitude=?,longitude=?,profile_completeness=?,profile_updated_at=? WHERE id=?`,[...vals,completeness,now(),b.id]);res.json(await getBusiness(b.id));}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/business/:id/hours',async(req,res)=>res.json(await all(`SELECT * FROM business_hours WHERE business_id=?`,[req.params.id])));
app.put('/api/business/:id/hours',auth,requireRole('BUSINESS_OWNER','ADMIN'),async(req,res)=>{try{if(req.user.role==='BUSINESS_OWNER'&&!await ownerFor(req,req.params.id))return res.status(403).json({error:'You do not own this business'});for(const h of req.body.hours||[]){await run(`INSERT INTO business_hours(business_id,day,is_closed,open_time,close_time,periods_json) VALUES(?,?,?,?,?,?) ON CONFLICT(business_id,day) DO UPDATE SET is_closed=excluded.is_closed,open_time=excluded.open_time,close_time=excluded.close_time,periods_json=excluded.periods_json`,[req.params.id,h.day,h.is_closed?1:0,h.open_time||null,h.close_time||null,JSON.stringify(h.periods||[])]);}await run(`UPDATE businesses SET profile_updated_at=? WHERE id=?`,[now(),req.params.id]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/business/:id/special-hours/today',async(req,res)=>{try{const date=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());res.json(await get(`SELECT date,is_closed,note FROM special_hours WHERE business_id=? AND date=?`,[req.params.id,date])||{date,is_closed:0,note:''});}catch(e){res.status(500).json({error:e.message});}});
app.put('/api/business/:id/special-hours/today',auth,requireRole('BUSINESS_OWNER','ADMIN'),async(req,res)=>{try{if(req.user.role==='BUSINESS_OWNER'&&!await ownerFor(req,req.params.id))return res.status(403).json({error:'You do not own this business'});const date=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const closed=req.body.is_closed?1:0;const note=String(req.body.note||'').trim().slice(0,160);if(closed) await run(`INSERT INTO special_hours(business_id,date,is_closed,note) VALUES(?,?,1,?) ON CONFLICT(business_id,date) DO UPDATE SET is_closed=1,note=excluded.note`,[req.params.id,date,note]);else await run(`DELETE FROM special_hours WHERE business_id=? AND date=?`,[req.params.id,date]);res.json({date,is_closed:closed,note});}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/saved',auth,async(req,res)=>{try{const bs=await all(`SELECT b.* FROM saved_businesses s JOIN businesses b ON b.id=s.business_id WHERE s.user_id=?`,[req.user.id]);const items=await all(`SELECT i.*,b.name business_name FROM saved_items s JOIN items i ON i.id=s.item_id JOIN businesses b ON b.id=i.business_id WHERE s.user_id=?`,[req.user.id]);res.json({businesses:await Promise.all(bs.map(enrichBusiness)),items});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/saved/business/:id',auth,async(req,res)=>{try{await run(`INSERT OR IGNORE INTO saved_businesses(user_id,business_id,created_at) VALUES(?,?,?)`,[req.user.id,req.params.id,now()]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});
app.delete('/api/saved/business/:id',auth,async(req,res)=>{await run(`DELETE FROM saved_businesses WHERE user_id=? AND business_id=?`,[req.user.id,req.params.id]);res.json({ok:true});});
app.post('/api/saved/item/:id',auth,async(req,res)=>{try{await run(`INSERT OR IGNORE INTO saved_items(user_id,item_id,created_at) VALUES(?,?,?)`,[req.user.id,req.params.id,now()]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});
app.delete('/api/saved/item/:id',auth,async(req,res)=>{await run(`DELETE FROM saved_items WHERE user_id=? AND item_id=?`,[req.user.id,req.params.id]);res.json({ok:true});});

app.get('/api/businesses/:id/photos',async(req,res)=>{try{const b=await get(`SELECT id FROM businesses WHERE id=?`,[req.params.id]);if(!b)return res.status(404).json({error:'Business not found'});res.json(await getBusinessPhotos(b.id));}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/businesses/:id/photos',auth,async(req,res)=>{try{
  const business=await get(`SELECT id FROM businesses WHERE id=?`,[req.params.id]);
  if(!business)return res.status(404).json({error:'Business not found'});
  const raw=String(req.body.image_data||'');
  const match=raw.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if(!match)return res.status(400).json({error:'Please choose a JPG, PNG, or WebP image.'});
  const mime=match[1].toLowerCase()==='image/jpg'?'image/jpeg':match[1].toLowerCase();
  const buffer=Buffer.from(match[2],'base64');
  if(buffer.length>5*1024*1024)return res.status(400).json({error:'Image is too large. Please choose a smaller photo.'});
  const ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
  const filename=`shop-${business.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir,filename),buffer);
  const r=await run(`INSERT INTO business_photos(business_id,user_id,image_url,caption,status,created_at) VALUES(?,?,?,?,?,?)`,[business.id,req.user.id,`/uploads/${filename}`,String(req.body.caption||'').trim().slice(0,180),'VISIBLE',now()]);
  const photo=await get(`SELECT p.id,p.business_id,p.user_id,p.image_url,p.caption,p.status,p.created_at,u.name uploader,u.role uploader_role FROM business_photos p JOIN users u ON u.id=p.user_id WHERE p.id=?`,[r.lastID]);
  const owner=await get(`SELECT user_id FROM business_owners WHERE business_id=? AND user_id<>?`,[business.id,req.user.id]);
  if(owner)await run(`INSERT INTO notifications(user_id,title,body,type,created_at) VALUES(?,?,?,?,?)`,[owner.user_id,'New shop photo',`${req.user.name||'A user'} added a photo to your business. Your gallery is now more up to date.`,'PHOTO',now()]);
  res.json(photo);
}catch(e){console.error(e);res.status(500).json({error:e.message});}});
app.delete('/api/business-photos/:id',auth,async(req,res)=>{try{
  const photo=await get(`SELECT * FROM business_photos WHERE id=?`,[req.params.id]);
  if(!photo)return res.status(404).json({error:'Photo not found'});
  const owner=await ownerFor(req,photo.business_id);
  if(req.user.role!=='ADMIN' && photo.user_id!==req.user.id && !owner)return res.status(403).json({error:'You are not allowed to remove this photo'});
  if(photo.image_url && photo.image_url.startsWith('/uploads/')){const file=path.join(uploadsDir,path.basename(photo.image_url));if(fs.existsSync(file))fs.unlinkSync(file);}
  await run(`DELETE FROM business_photos WHERE id=?`,[photo.id]);res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/reviews',auth,async(req,res)=>{try{const {business_id,rating,quality,behaviour,value,accuracy,cleanliness,body}=req.body;const reviewBody=String(body||'').trim();if(!business_id||!rating||!reviewBody)return res.status(400).json({error:'Business, rating and review are required'});const r=await run(`INSERT INTO reviews(business_id,user_id,rating,quality,behaviour,value,accuracy,cleanliness,body,verification,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,[business_id,req.user.id,rating,quality||null,behaviour||null,value||null,accuracy||null,cleanliness||null,reviewBody,'UNVERIFIED','VISIBLE']);const stats=await get(`SELECT AVG(rating) avg,COUNT(*) c FROM reviews WHERE business_id=? AND status='VISIBLE'`,[business_id]);await run(`UPDATE businesses SET rating=?,reviews_count=? WHERE id=?`,[Number(stats.avg||0).toFixed(1),stats.c,business_id]);const own=await get(`SELECT user_id FROM business_owners WHERE business_id=?`,[business_id]);if(own)await run(`INSERT INTO notifications(user_id,title,body,type,created_at) VALUES(?,?,?,?,?)`,[own.user_id,'New review','A customer left feedback on your business.','REVIEW',now()]);res.json({id:r.lastID});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/reviews/:id/response',auth,requireRole('BUSINESS_OWNER','ADMIN'),async(req,res)=>{try{const review=await get(`SELECT * FROM reviews WHERE id=?`,[req.params.id]);if(!review)return res.status(404).json({error:'Review not found'});if(req.user.role==='BUSINESS_OWNER'&&!await ownerFor(req,review.business_id))return res.status(403).json({error:'Not your business'});await run(`INSERT INTO review_responses(review_id,business_id,body,created_at) VALUES(?,?,?,?) ON CONFLICT(review_id) DO UPDATE SET body=excluded.body,created_at=excluded.created_at`,[review.id,review.business_id,req.body.body,now()]);await run(`INSERT INTO notifications(user_id,title,body,type,created_at) VALUES(?,?,?,?,?)`,[review.user_id,'Business replied','A business responded to your review.','REVIEW',now()]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/reports',auth,async(req,res)=>{try{await run(`INSERT INTO reports(reporter_user_id,target_type,target_id,reason,created_at) VALUES(?,?,?,?,?)`,[req.user.id,req.body.target_type,req.body.target_id,req.body.reason,now()]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/notifications',auth,async(req,res)=>res.json(await all(`SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50`,[req.user.id])));
app.patch('/api/notifications/:id/read',auth,async(req,res)=>{await run(`UPDATE notifications SET read=1 WHERE id=? AND user_id=?`,[req.params.id,req.user.id]);res.json({ok:true});});
app.get('/api/profile',auth,async(req,res)=>res.json({...req.user, preferences:await get(`SELECT * FROM notification_preferences WHERE user_id=?`,[req.user.id])}));
app.patch('/api/profile',auth,async(req,res)=>{try{const {name,location}=req.body;await run(`UPDATE users SET name=?,location=? WHERE id=?`,[name||req.user.name,location||req.user.location,req.user.id]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/claims',auth,requireRole('BUSINESS_OWNER'),async(req,res)=>{try{await run(`INSERT INTO business_claims(business_id,user_id,status,note,created_at) VALUES(?,?,?,?,?)`,[req.body.business_id,req.user.id,'PENDING',req.body.note||'',now()]);await run(`UPDATE businesses SET verification_status='PENDING' WHERE id=? AND verification_status='UNCLAIMED'`,[req.body.business_id]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/admin/overview',auth,requireRole('ADMIN'),async(req,res)=>{try{const [users,businesses,claims,reports,reviews]=await Promise.all([get('SELECT COUNT(*) c FROM users'),get('SELECT COUNT(*) c FROM businesses'),get("SELECT COUNT(*) c FROM business_claims WHERE status='PENDING'"),get("SELECT COUNT(*) c FROM reports WHERE status='OPEN'"),get("SELECT COUNT(*) c FROM reviews WHERE status='VISIBLE'")]);res.json({users:users.c,businesses:businesses.c,pendingClaims:claims.c,openReports:reports.c,reviews:reviews.c});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/admin/claims',auth,requireRole('ADMIN'),async(req,res)=>res.json(await all(`SELECT c.*,b.name business_name,u.email FROM business_claims c JOIN businesses b ON b.id=c.business_id JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC`)));
app.patch('/api/admin/claims/:id',auth,requireRole('ADMIN'),async(req,res)=>{try{const c=await get(`SELECT * FROM business_claims WHERE id=?`,[req.params.id]);if(!c)return res.status(404).json({error:'Claim not found'});await run(`UPDATE business_claims SET status=? WHERE id=?`,[req.body.status,c.id]);if(req.body.status==='APPROVED'){await run(`INSERT OR REPLACE INTO business_owners(business_id,user_id,claim_status) VALUES(?,?,?)`,[c.business_id,c.user_id,'VERIFIED']);await run(`UPDATE businesses SET verification_status='VERIFIED',verified=1 WHERE id=?`,[c.business_id]);}res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/admin/reports',auth,requireRole('ADMIN'),async(req,res)=>res.json(await all(`SELECT r.*,u.email reporter_email FROM reports r LEFT JOIN users u ON u.id=r.reporter_user_id ORDER BY r.created_at DESC`)));
app.patch('/api/admin/reports/:id',auth,requireRole('ADMIN'),async(req,res)=>{await run(`UPDATE reports SET status=?,resolution=? WHERE id=?`,[req.body.status||'RESOLVED',req.body.resolution||'',req.params.id]);res.json({ok:true});});
app.get('/api/admin/users',auth,requireRole('ADMIN'),async(req,res)=>res.json(await all(`SELECT id,name,email,role,location,created_at FROM users ORDER BY created_at DESC`)));
app.get('/api/admin/businesses',auth,requireRole('ADMIN'),async(req,res)=>res.json(await all(`SELECT id,name,category,verification_status,profile_completeness,rating,reviews_count FROM businesses ORDER BY id DESC`)));

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Unexpected server error'});});

init().then(()=>app.listen(PORT,()=>console.log(`Market Hub backend running at http://localhost:${PORT}`))).catch(e=>{console.error('Startup failed',e);process.exit(1);});
