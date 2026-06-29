import express from "express";
import path from "path";
import fs from "fs";
import jwt from "jsonwebtoken";
import qrcode from "qrcode";
import bcrypt from "bcryptjs";
import { createServer as createViteServer } from "vite";
import admin from "firebase-admin";

const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "nox-luxury-secret-key-2026-gold";
const DB_PATH = path.join(process.cwd(), "data", "nox.json");

// Firebase Configuration & Initialization
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
let firebaseAdminApp: any = null;
let firestore: any = null;

if (fs.existsSync(configPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    firebaseAdminApp = (admin as any).initializeApp({
      projectId: config.projectId,
    });
    firestore = (admin as any).firestore();
    console.log(`[Firebase] Admin SDK initialized with Project ID: ${config.projectId}`);
  } catch (err) {
    console.error("[Firebase] Failed to initialize Admin SDK:", err);
  }
} else {
  console.log("[Firebase] Config file not found. Initializing Admin SDK with environment defaults.");
  try {
    firebaseAdminApp = (admin as any).initializeApp();
    firestore = (admin as any).firestore();
  } catch (err) {
    console.error("[Firebase] Failed to initialize default Admin SDK:", err);
  }
}

// Ensure data folder exists
if (!fs.existsSync(path.join(process.cwd(), "data"))) {
  fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
}

// Ensure JWT, Express JSON and Form parsing
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Types
interface Watch {
  id: string;
  name: string;
  model: string;
  color: string;
  price: number;
  stock: number;
  description: string;
  image: string;
  warrantyPeriod: number; // in months
}

interface Sale {
  warrantyId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerAddress?: string;
  watchId: string;
  watchModel: string;
  watchColor: string;
  purchaseDate: string;
  expiryDate: string;
  warrantyPeriod: number;
  price: number;
  invoiceNumber?: string;
  qrCode: string; // Base64 Data URL
  status: "Active" | "Expired" | "Claimed";
}

interface Claim {
  id: string;
  warrantyId: string;
  issueType: "Strap Problem" | "Machine Issue" | "Glass Damage" | "Battery" | "Water Damage" | "Other";
  description: string;
  images: string[]; // Base64 or links
  status: "Pending" | "In Progress" | "Approved" | "Rejected" | "Resolved";
  customerName: string;
  watchModel: string;
  createdAt: string;
  updatedAt: string;
}

interface ActivityLog {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  details: string;
}

interface Database {
  users: { id: string; username: string; passwordHash: string; role: "admin" }[];
  watches: Watch[];
  sales: Sale[];
  claims: Claim[];
  logs: ActivityLog[];
}

// DB Load and Save Helpers
function loadDB(): Database {
  if (!fs.existsSync(DB_PATH)) {
    // Generate default/mock DB
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync("admin", salt);

    const defaultWatches: Watch[] = [
      {
        id: "nox-chrono-gold",
        name: "NOX Chrono-Gold",
        model: "Chrono-Gold V1",
        color: "Black & 18K Gold",
        price: 12500,
        stock: 8,
        description: "Elegant black skeletal dial paired with meticulously polished 18K gold casing. Features automatic hand-assembled calibre movement.",
        image: "https://images.unsplash.com/photo-1547996160-81dfa63595aa?auto=format&fit=crop&w=600&q=80",
        warrantyPeriod: 24,
      },
      {
        id: "nox-eclipse-titanium",
        name: "NOX Eclipse",
        model: "Eclipse Sport III",
        color: "Matte Carbon Black",
        price: 9800,
        stock: 15,
        description: "Indestructible grade 5 stealth titanium framework with a futuristic luminous watch face. Complete scratch-resistant sapphire glass.",
        image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80",
        warrantyPeriod: 36,
      },
      {
        id: "nox-heritage-classic",
        name: "NOX Heritage",
        model: "Heritage Classic X",
        color: "Rose Gold & Genuine Leather",
        price: 14200,
        stock: 5,
        description: "Sophisticated classical aesthetic featuring 18K rose gold bezel, skeleton rear window, and dark mahogany hand-stitched leather strap.",
        image: "https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=600&q=80",
        warrantyPeriod: 24,
      },
      {
        id: "nox-stella-mesh",
        name: "NOX Stella",
        model: "Stella Minimalist",
        color: "Sandblasted Gold Mesh",
        price: 6500,
        stock: 22,
        description: "Ultra-thin golden profile styled with minimalist markers and fine golden steel mesh strap. High-precision Swiss movement.",
        image: "https://images.unsplash.com/photo-1614162692292-7ac56d7f7f1e?auto=format&fit=crop&w=600&q=80",
        warrantyPeriod: 12,
      },
    ];

    const defaultDB: Database = {
      users: [{ id: "user-admin", username: "admin", passwordHash, role: "admin" }],
      watches: defaultWatches,
      sales: [],
      claims: [],
      logs: [
        {
          id: "log-init",
          timestamp: new Date().toISOString(),
          user: "System",
          action: "Initialize",
          details: "NOX Database initialized successfully.",
        },
      ],
    };

    // Pre-create some sample sales
    const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;

    // Helper to sync seed QR
    const sale1: Sale = {
      warrantyId: "NOX-2026-000001",
      customerName: "Audrey Hepburn",
      customerPhone: "+15551234567",
      customerEmail: "audrey@classic.com",
      customerAddress: "45 Tiffany Way, Manhattan, NY",
      watchId: "nox-chrono-gold",
      watchModel: "Chrono-Gold V1",
      watchColor: "Black & 18K Gold",
      purchaseDate: "2026-01-15T12:00:00.000Z",
      expiryDate: "2028-01-15T12:00:00.000Z",
      warrantyPeriod: 24,
      price: 12500,
      invoiceNumber: "INV-2026-001",
      qrCode: "",
      status: "Active",
    };

    const sale2: Sale = {
      warrantyId: "NOX-2026-000002",
      customerName: "Steve McQueen",
      customerPhone: "+15559876543",
      customerEmail: "steve@mcqueen.io",
      customerAddress: "12 Le Mans Circuit, California",
      watchId: "nox-eclipse-titanium",
      watchModel: "Eclipse Sport III",
      watchColor: "Matte Carbon Black",
      purchaseDate: "2026-03-22T10:30:00.000Z",
      expiryDate: "2029-03-22T10:30:00.000Z",
      warrantyPeriod: 36,
      price: 9800,
      invoiceNumber: "INV-2026-002",
      qrCode: "",
      status: "Active",
    };

    const sale3: Sale = {
      warrantyId: "NOX-2026-000003",
      customerName: "Marilyn Monroe",
      customerPhone: "+15555550199",
      customerEmail: "marilyn@diamonds.org",
      customerAddress: "777 Hollywood Blvd, Los Angeles, CA",
      watchId: "nox-stella-mesh",
      watchModel: "Stella Minimalist",
      watchColor: "Sandblasted Gold Mesh",
      purchaseDate: "2025-06-10T14:15:00.000Z",
      expiryDate: "2026-06-10T14:15:00.000Z", // Just expired based on local date (June 28, 2026)
      warrantyPeriod: 12,
      price: 6500,
      invoiceNumber: "INV-2025-098",
      qrCode: "",
      status: "Expired",
    };

    // Generate QR codes for default sales
    try {
      sale1.qrCode = syncGenerateQRCode(`${appUrl}/warranty/${sale1.warrantyId}`);
      sale2.qrCode = syncGenerateQRCode(`${appUrl}/warranty/${sale2.warrantyId}`);
      sale3.qrCode = syncGenerateQRCode(`${appUrl}/warranty/${sale3.warrantyId}`);
    } catch (e) {
      console.error("Failed to generate default QR codes", e);
    }

    defaultDB.sales = [sale1, sale2, sale3];

    // Seed some claims
    defaultDB.claims = [
      {
        id: "claim-001",
        warrantyId: "NOX-2026-000002",
        issueType: "Battery",
        description: "The battery ran out after a high-speed driving session. Need calibration.",
        images: ["https://images.unsplash.com/photo-1509048191080-d2984bad6ae5?auto=format&fit=crop&w=400&q=80"],
        status: "Pending",
        customerName: "Steve McQueen",
        watchModel: "Eclipse Sport III",
        createdAt: "2026-06-25T08:12:00.000Z",
        updatedAt: "2026-06-25T08:12:00.000Z",
      },
      {
        id: "claim-002",
        warrantyId: "NOX-2026-000001",
        issueType: "Strap Problem",
        description: "The golden clasp is loose. It doesn't close securely with a satisfying click.",
        images: ["https://images.unsplash.com/photo-1612817288484-6f916006741a?auto=format&fit=crop&w=400&q=80"],
        status: "In Progress",
        customerName: "Audrey Hepburn",
        watchModel: "Chrono-Gold V1",
        createdAt: "2026-06-26T15:20:00.000Z",
        updatedAt: "2026-06-27T10:00:00.000Z",
      },
    ];

    // Subtract watch stocks for default sales
    defaultDB.watches[0].stock -= 1; // Chrono-Gold
    defaultDB.watches[1].stock -= 1; // Eclipse
    defaultDB.watches[3].stock -= 1; // Stella

    saveDB(defaultDB);
    return defaultDB;
  }

  const data = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(data);
}

// Helper to sync individual collections in Firestore asynchronously
async function syncIndividualCollections(db: Database) {
  if (!firestore) return;
  try {
    console.log("[Firebase] Starting full sync of individual collections...");
    
    // Sync watches
    for (const w of db.watches) {
      await firestore.collection("watches").doc(w.id).set(w);
    }
    
    // Sync sales
    for (const s of db.sales) {
      await firestore.collection("sales").doc(s.warrantyId).set(s);
    }
    
    // Sync claims
    for (const c of db.claims) {
      await firestore.collection("claims").doc(c.id).set(c);
    }
    
    // Sync logs (limit to last 100 for performance)
    const logsToSync = db.logs.slice(0, 100);
    for (const l of logsToSync) {
      await firestore.collection("logs").doc(l.id).set(l);
    }
    
    console.log("[Firebase] Successfully synchronized individual Firestore collections.");
  } catch (err) {
    console.error("[Firebase] Error syncing individual collections to Firestore:", err);
  }
}

function saveDB(db: Database) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
  
  if (firestore) {
    firestore.collection("nox_system").doc("database_state").set(db)
      .then(() => {
        console.log("[Firebase] Backed up database state to Firestore.");
        return syncIndividualCollections(db);
      })
      .catch((err) => {
        console.error("[Firebase] Failed to back up database to Firestore:", err);
      });
  }
}

// Generate QR Code synchronously (or simulated synchronously using qrcode library sync methods)
function syncGenerateQRCode(url: string): string {
  // Use let code; qrcode.toDataURL sync
  let qrData = "";
  qrcode.toDataURL(url, { margin: 1, width: 256, color: { dark: "#D4AF37", light: "#000000" } }, (err, urlData) => {
    if (!err && urlData) {
      qrData = urlData;
    }
  });
  return qrData || "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
}

// Helper to update warranty states automatically (Active vs Expired) based on current date
function autoUpdateWarrantyStatus(db: Database) {
  const now = new Date();
  let updated = false;
  db.sales.forEach((sale) => {
    const exp = new Date(sale.expiryDate);
    if (sale.status !== "Claimed") {
      if (exp < now && sale.status !== "Expired") {
        sale.status = "Expired";
        updated = true;
      } else if (exp >= now && sale.status !== "Active") {
        sale.status = "Active";
        updated = true;
      }
    }
  });
  if (updated) {
    saveDB(db);
  }
}

// Init DB
let dbInstance = loadDB();
autoUpdateWarrantyStatus(dbInstance);

// Sync with Firestore asynchronously on startup
async function syncFirestoreAtStartup() {
  if (!firestore) {
    console.log("[Firebase] Firestore is not available. Using purely local database cache.");
    return;
  }

  try {
    console.log("[Firebase] Synchronizing with Cloud Firestore database at startup...");
    const docRef = firestore.collection("nox_system").doc("database_state");
    const doc = await docRef.get();

    if (doc.exists) {
      const cloudDB = doc.data() as Database;
      dbInstance = cloudDB;
      fs.writeFileSync(DB_PATH, JSON.stringify(cloudDB, null, 2), "utf-8");
      console.log("[Firebase] Successfully loaded database state from Firestore and synced local cache.");
    } else {
      console.log("[Firebase] No existing state found in Firestore. Uploading current state as baseline...");
      await docRef.set(dbInstance);
      await syncIndividualCollections(dbInstance);
    }
  } catch (err) {
    console.error("[Firebase] Error during Firestore startup synchronization:", err);
  }
}

// Create default admin user in Firebase Authentication at startup
async function ensureDefaultAdminUser() {
  if (!firebaseAdminApp) return;
  try {
    const adminEmail = "admin@noxwatch.com";
    try {
      await (admin as any).auth().getUserByEmail(adminEmail);
      console.log(`[Firebase] Default admin user (${adminEmail}) already exists in Authentication.`);
    } catch (err: any) {
      if (err.code === "auth/user-not-found") {
        await (admin as any).auth().createUser({
          email: adminEmail,
          password: "adminpassword",
          displayName: "NOX Admin",
        });
        console.log(`[Firebase] Successfully created default admin user (${adminEmail}) with password 'adminpassword' in Authentication.`);
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error("[Firebase] Error ensuring default Firebase Admin user:", err);
  }
}

// Run asynchronous initialization
syncFirestoreAtStartup().then(() => {
  ensureDefaultAdminUser();
});

// Authentication Middleware
interface AuthRequest extends express.Request {
  user?: {
    id: string;
    username: string;
    role: string;
  };
}

const authMiddleware = async (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  const token = authHeader.split(" ")[1];

  // Try to verify as Firebase ID Token first if Firebase Admin is available
  if (firebaseAdminApp) {
    try {
      const decodedToken = await (admin as any).auth().verifyIdToken(token);
      req.user = {
        id: decodedToken.uid,
        username: decodedToken.email || "admin",
        role: "admin", // All authenticated Firebase logins are treated as admin
      };
      return next();
    } catch (err) {
      // If Firebase verification fails, continue to local JWT verification fallback
    }
  }

  // Fallback to local JWT
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; username: string; role: string };
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired authentication token." });
  }
};

// --- API ENDPOINTS ---

// Firebase configuration retrieval route
app.get("/api/firebase-config", (req, res) => {
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      // Send the client-safe fields
      res.json({
        projectId: config.projectId,
        appId: config.appId,
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        firestoreDatabaseId: config.firestoreDatabaseId || "",
        storageBucket: config.storageBucket || "",
        messagingSenderId: config.messagingSenderId || "",
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to read Firebase config." });
    }
  } else {
    res.status(404).json({ error: "Firebase configuration file not found." });
  }
});

// 1. Auth Route
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const db = loadDB();
  const user = db.users.find((u) => u.username.toLowerCase() === username.toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid administrative credentials." });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  });
});

app.get("/api/auth/me", authMiddleware, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

// Customer Login by Phone Number (gives access to their warranties and claims)
app.post("/api/auth/customer-login", (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: "Phone number is required." });
  }

  const db = loadDB();
  // Filter sales matching the phone number (clean whitespace & comparison)
  const cleanInput = phone.replace(/[\s\-\(\)\+]/g, "");
  const customerSales = db.sales.filter((s) => {
    const cleanSalePhone = s.customerPhone.replace(/[\s\-\(\)\+]/g, "");
    return cleanSalePhone.endsWith(cleanInput) || cleanInput.endsWith(cleanSalePhone);
  });

  if (customerSales.length === 0) {
    return res.status(404).json({ error: "No watch purchase records found with this phone number." });
  }

  const customerName = customerSales[0].customerName;
  const token = jwt.sign(
    { phone, name: customerName, role: "customer" },
    JWT_SECRET,
    { expiresIn: "30d" }
  );

  res.json({
    token,
    customer: {
      name: customerName,
      phone: phone,
      warrantiesCount: customerSales.length,
    },
  });
});

// 2. Inventory / Watches
app.get("/api/inventory", (req, res) => {
  const db = loadDB();
  res.json(db.watches);
});

app.post("/api/inventory", authMiddleware, (req: AuthRequest, res) => {
  const { name, model, color, price, stock, description, image, warrantyPeriod } = req.body;
  if (!name || !model || !color || !price || stock === undefined || !warrantyPeriod) {
    return res.status(400).json({ error: "Required inventory fields are missing." });
  }

  const db = loadDB();
  const newWatch: Watch = {
    id: `nox-${model.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now().toString().slice(-4)}`,
    name,
    model,
    color,
    price: parseFloat(price),
    stock: parseInt(stock),
    description: description || "",
    image: image || "https://images.unsplash.com/photo-1547996160-81dfa63595aa?auto=format&fit=crop&w=600&q=80",
    warrantyPeriod: parseInt(warrantyPeriod),
  };

  db.watches.push(newWatch);

  // Activity Log
  const log: ActivityLog = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    user: req.user?.username || "Admin",
    action: "Add Watch",
    details: `Added new watch model to inventory: ${name} (${model}) with stock of ${stock}.`,
  };
  db.logs.unshift(log);

  saveDB(db);
  res.status(201).json(newWatch);
});

app.put("/api/inventory/:id", authMiddleware, (req: AuthRequest, res) => {
  const { id } = req.params;
  const { name, model, color, price, stock, description, image, warrantyPeriod } = req.body;

  const db = loadDB();
  const watchIndex = db.watches.findIndex((w) => w.id === id);
  if (watchIndex === -1) {
    return res.status(404).json({ error: "Watch model not found." });
  }

  const currentWatch = db.watches[watchIndex];
  const updatedWatch: Watch = {
    ...currentWatch,
    name: name || currentWatch.name,
    model: model || currentWatch.model,
    color: color || currentWatch.color,
    price: price !== undefined ? parseFloat(price) : currentWatch.price,
    stock: stock !== undefined ? parseInt(stock) : currentWatch.stock,
    description: description !== undefined ? description : currentWatch.description,
    image: image || currentWatch.image,
    warrantyPeriod: warrantyPeriod !== undefined ? parseInt(warrantyPeriod) : currentWatch.warrantyPeriod,
  };

  db.watches[watchIndex] = updatedWatch;

  // Activity Log
  const log: ActivityLog = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    user: req.user?.username || "Admin",
    action: "Update Watch",
    details: `Updated watch model in inventory: ${updatedWatch.name}. Stock: ${updatedWatch.stock}.`,
  };
  db.logs.unshift(log);

  saveDB(db);
  res.json(updatedWatch);
});

// 3. Sales & Warranties
app.get("/api/sales", authMiddleware, (req, res) => {
  const db = loadDB();
  autoUpdateWarrantyStatus(db);
  
  // Basic search & filter
  const { search } = req.query;
  let results = [...db.sales];

  if (search) {
    const q = (search as string).toLowerCase();
    results = results.filter(
      (s) =>
        s.customerName.toLowerCase().includes(q) ||
        s.customerPhone.includes(q) ||
        s.warrantyId.toLowerCase().includes(q) ||
        (s.invoiceNumber && s.invoiceNumber.toLowerCase().includes(q)) ||
        s.watchModel.toLowerCase().includes(q)
    );
  }

  // Sort by purchase date descending
  results.sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());

  res.json(results);
});

// POST Create Sale & Warranty registration
app.post("/api/sales", authMiddleware, async (req: AuthRequest, res) => {
  const {
    customerName,
    customerPhone,
    customerEmail,
    customerAddress,
    watchId,
    purchaseDate,
    warrantyPeriod,
    price,
    invoiceNumber,
  } = req.body;

  if (!customerName || !customerPhone || !watchId || !purchaseDate || !warrantyPeriod || !price) {
    return res.status(400).json({ error: "Missing parameters for generating warranty." });
  }

  const db = loadDB();

  // Find Watch in Inventory
  const watch = db.watches.find((w) => w.id === watchId);
  if (!watch) {
    return res.status(404).json({ error: "Selected watch model not found in inventory." });
  }

  if (watch.stock <= 0) {
    return res.status(400).json({ error: "Selected watch is out of stock." });
  }

  // Deduct Stock
  watch.stock -= 1;

  // Generate Warranty Registration ID: NOX-2026-000001
  const year = new Date(purchaseDate).getFullYear();
  const salesInYear = db.sales.filter((s) => s.warrantyId.startsWith(`NOX-${year}-`));
  
  let nextSeq = 1;
  if (salesInYear.length > 0) {
    const seqs = salesInYear.map((s) => {
      const parts = s.warrantyId.split("-");
      return parseInt(parts[2]) || 0;
    });
    nextSeq = Math.max(...seqs) + 1;
  }
  const paddedSeq = String(nextSeq).padStart(6, "0");
  const warrantyId = `NOX-${year}-${paddedSeq}`;

  // Calculate Warranty Expiry Date automatically
  const pDate = new Date(purchaseDate);
  const expiryDate = new Date(pDate.setMonth(pDate.getMonth() + parseInt(warrantyPeriod))).toISOString();

  // Generate QR Code containing URL only
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const qrUrl = `${appUrl}/warranty/${warrantyId}`;

  let qrCodeBase64 = "";
  try {
    qrCodeBase64 = await qrcode.toDataURL(qrUrl, {
      margin: 1,
      width: 256,
      color: {
        dark: "#D4AF37", // Elegant gold qr
        light: "#000000", // Dark backdrop
      },
    });
  } catch (err) {
    console.error("QR Code Generation Error:", err);
    qrCodeBase64 = "data:image/png;base64,..."; // fallback
  }

  // Create Sale Record
  const newSale: Sale = {
    warrantyId,
    customerName,
    customerPhone,
    customerEmail: customerEmail || "",
    customerAddress: customerAddress || "",
    watchId: watch.id,
    watchModel: watch.name,
    watchColor: watch.color,
    purchaseDate: new Date(purchaseDate).toISOString(),
    expiryDate,
    warrantyPeriod: parseInt(warrantyPeriod),
    price: parseFloat(price),
    invoiceNumber: invoiceNumber || "",
    qrCode: qrCodeBase64,
    status: new Date(expiryDate) > new Date() ? "Active" : "Expired",
  };

  db.sales.push(newSale);

  // Add Activity Log
  const log: ActivityLog = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    user: req.user?.username || "Admin",
    action: "New Sale & Warranty",
    details: `Registered sale & generated warranty ${warrantyId} for customer ${customerName}. Watch: ${watch.name}.`,
  };
  db.logs.unshift(log);

  saveDB(db);

  res.status(201).json(newSale);
});

// 4. Public Warranty Lookup Page (customer scans QR)
app.get("/api/warranty/:id", (req, res) => {
  const { id } = req.params;
  const db = loadDB();
  autoUpdateWarrantyStatus(db);

  const sale = db.sales.find((s) => s.warrantyId.toUpperCase() === id.toUpperCase());
  if (!sale) {
    return res.status(404).json({ error: "Warranty registration not found." });
  }

  // Get active claims for this warranty
  const claims = db.claims.filter((c) => c.warrantyId.toUpperCase() === id.toUpperCase());

  // Return warranty info along with watch image and claims
  const watch = db.watches.find((w) => w.id === sale.watchId);
  const watchImage = watch ? watch.image : "https://images.unsplash.com/photo-1547996160-81dfa63595aa?auto=format&fit=crop&w=600&q=80";
  const watchDescription = watch ? watch.description : "";

  res.json({
    warranty: sale,
    watchImage,
    watchDescription,
    claims,
  });
});

// Submit a claim (Public but verified using phone number)
app.post("/api/warranty/:id/claim", async (req, res) => {
  const { id } = req.params;
  const { phone, issueType, description, images } = req.body;

  if (!phone || !issueType || !description) {
    return res.status(400).json({ error: "Phone number verification, issue type, and description are required." });
  }

  const db = loadDB();
  const sale = db.sales.find((s) => s.warrantyId.toUpperCase() === id.toUpperCase());

  if (!sale) {
    return res.status(404).json({ error: "Warranty record not found." });
  }

  // Verify Ownership with phone comparison
  const cleanInputPhone = phone.replace(/[\s\-\(\)\+]/g, "");
  const cleanSalePhone = sale.customerPhone.replace(/[\s\-\(\)\+]/g, "");

  if (!cleanSalePhone.endsWith(cleanInputPhone) && !cleanInputPhone.endsWith(cleanSalePhone)) {
    return res.status(403).json({ error: "Verification failed. Phone number does not match the purchase record." });
  }

  if (sale.status === "Expired") {
    return res.status(400).json({ error: "Warranty has expired. Claims are no longer permitted." });
  }

  // Generate Claim ID
  const claimSeq = db.claims.length + 1;
  const claimId = `CLM-${Date.now().toString().slice(-4)}-${String(claimSeq).padStart(3, "0")}`;

  const newClaim: Claim = {
    id: claimId,
    warrantyId: sale.warrantyId,
    issueType,
    description,
    images: images || [], // base64 strings
    status: "Pending",
    customerName: sale.customerName,
    watchModel: sale.watchModel,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.claims.unshift(newClaim);

  // If claim submitted, we can also keep status as Active or Claimed depending on workflow
  // Let's keep status "Active" (with pending claim) or tag as "Claimed" if requested,
  // usually it remains active until resolved/replaced. Let's keep it Active.

  // Activity Log
  const log: ActivityLog = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    user: "Customer",
    action: "File Claim",
    details: `Customer filed warranty claim ${claimId} for warranty ${sale.warrantyId}. Issue: ${issueType}.`,
  };
  db.logs.unshift(log);

  saveDB(db);

  res.status(201).json(newClaim);
});

// Customer-Specific Warranties (for Customer Portal)
app.get("/api/customers/warranties", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "No token provided." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { phone: string; name: string; role: string };
    if (decoded.role !== "customer") {
      return res.status(403).json({ error: "Invalid customer session." });
    }

    const db = loadDB();
    autoUpdateWarrantyStatus(db);

    const cleanPhone = decoded.phone.replace(/[\s\-\(\)\+]/g, "");

    const customerSales = db.sales.filter((s) => {
      const cleanSalePhone = s.customerPhone.replace(/[\s\-\(\)\+]/g, "");
      return cleanSalePhone.endsWith(cleanPhone) || cleanPhone.endsWith(cleanSalePhone);
    });

    const warrantiesWithWatch = customerSales.map((s) => {
      const watch = db.watches.find((w) => w.id === s.watchId);
      return {
        ...s,
        watchImage: watch ? watch.image : "",
        watchDescription: watch ? watch.description : "",
        claims: db.claims.filter((c) => c.warrantyId === s.warrantyId),
      };
    });

    res.json(warrantiesWithWatch);
  } catch (err) {
    res.status(401).json({ error: "Session expired. Please log in again." });
  }
});

// 5. Admin Claims Management
app.get("/api/claims", authMiddleware, (req, res) => {
  const db = loadDB();
  res.json(db.claims);
});

app.put("/api/claims/:id", authMiddleware, (req: AuthRequest, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Claim status is required." });
  }

  const db = loadDB();
  const claimIndex = db.claims.findIndex((c) => c.id === id);
  if (claimIndex === -1) {
    return res.status(404).json({ error: "Claim record not found." });
  }

  const claim = db.claims[claimIndex];
  const oldStatus = claim.status;
  claim.status = status;
  claim.updatedAt = new Date().toISOString();

  // If resolved, maybe update warranty status to Claimed if applicable?
  // Let's keep it as is, or update associated sale status to "Claimed" if claim is approved
  if (status === "Approved") {
    const sale = db.sales.find((s) => s.warrantyId === claim.warrantyId);
    if (sale) {
      sale.status = "Claimed";
    }
  }

  // Activity Log
  const log: ActivityLog = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    user: req.user?.username || "Admin",
    action: "Update Claim",
    details: `Updated claim ${claim.id} status from '${oldStatus}' to '${status}'.`,
  };
  db.logs.unshift(log);

  saveDB(db);
  res.json(claim);
});

// 6. Analytics Stats Dashboard
app.get("/api/dashboard/stats", authMiddleware, (req, res) => {
  const db = loadDB();
  autoUpdateWarrantyStatus(db);

  const totalSalesCount = db.sales.length;
  const activeWarranties = db.sales.filter((s) => s.status === "Active").length;
  const expiredWarranties = db.sales.filter((s) => s.status === "Expired").length;
  const pendingClaims = db.claims.filter((c) => c.status === "Pending").length;
  const resolvedClaims = db.claims.filter((c) => c.status === "Resolved" || c.status === "Approved").length;
  const totalRevenue = db.sales.reduce((sum, s) => sum + s.price, 0);

  // Recent 5 sales
  const recentSales = [...db.sales]
    .sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime())
    .slice(0, 5);

  // Recent 5 claims
  const recentClaims = [...db.claims]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  // Monthly Sales Aggregation (Last 6 Months)
  // Let's build a clean, real calendar map for mock dynamic calculations
  const monthlyRevenue: { [month: string]: number } = {};
  const monthlyClaims: { [month: string]: number } = {};

  const last6Months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const monthName = d.toLocaleString("default", { month: "short", year: "2-digit" });
    last6Months.push(monthName);
    monthlyRevenue[monthName] = 0;
    monthlyClaims[monthName] = 0;
  }

  db.sales.forEach((s) => {
    const d = new Date(s.purchaseDate);
    const monthName = d.toLocaleString("default", { month: "short", year: "2-digit" });
    if (monthlyRevenue[monthName] !== undefined) {
      monthlyRevenue[monthName] += s.price;
    }
  });

  db.claims.forEach((c) => {
    const d = new Date(c.createdAt);
    const monthName = d.toLocaleString("default", { month: "short", year: "2-digit" });
    if (monthlyClaims[monthName] !== undefined) {
      monthlyClaims[monthName] += 1;
    }
  });

  const chartSalesData = last6Months.map((m) => ({
    month: m,
    revenue: monthlyRevenue[m],
    salesCount: db.sales.filter((s) => {
      const d = new Date(s.purchaseDate);
      return d.toLocaleString("default", { month: "short", year: "2-digit" }) === m;
    }).length,
  }));

  const chartClaimsData = last6Months.map((m) => ({
    month: m,
    claims: monthlyClaims[m],
  }));

  // Top Selling Models
  const modelSalesCount: { [model: string]: { count: number; revenue: number } } = {};
  db.sales.forEach((s) => {
    if (!modelSalesCount[s.watchModel]) {
      modelSalesCount[s.watchModel] = { count: 0, revenue: 0 };
    }
    modelSalesCount[s.watchModel].count += 1;
    modelSalesCount[s.watchModel].revenue += s.price;
  });

  const topSellingModels = Object.keys(modelSalesCount).map((model) => ({
    model,
    count: modelSalesCount[model].count,
    revenue: modelSalesCount[model].revenue,
  }));

  res.json({
    cards: {
      totalSalesCount,
      activeWarranties,
      expiredWarranties,
      pendingClaims,
      resolvedClaims,
      totalRevenue,
    },
    recentSales,
    recentClaims,
    charts: {
      salesHistory: chartSalesData,
      claimsHistory: chartClaimsData,
      topModels: topSellingModels,
      warrantyStatus: [
        { name: "Active", value: activeWarranties },
        { name: "Expired", value: expiredWarranties },
        { name: "Claimed", value: db.sales.filter((s) => s.status === "Claimed").length },
      ],
    },
  });
});

// 7. System Logs
app.get("/api/logs", authMiddleware, (req, res) => {
  const db = loadDB();
  res.json(db.logs);
});

// 8. Reset DB (Clear Sales & Claims)
app.post("/api/admin/reset", authMiddleware, (req: AuthRequest, res) => {
  const db = loadDB();
  db.sales = [];
  db.claims = [];
  
  // Reset stocks of default watches
  db.watches.forEach((w) => {
    if (w.id === "nox-chrono-gold") w.stock = 8;
    if (w.id === "nox-eclipse-titanium") w.stock = 15;
    if (w.id === "nox-heritage-classic") w.stock = 5;
    if (w.id === "nox-stella-mesh") w.stock = 22;
  });

  db.logs.push({
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    user: req.user?.username || "admin",
    action: "Reset Database",
    details: "Reset all sales, active coverage warranties, and claim records.",
  });

  saveDB(db);
  res.json({ success: true, message: "Sales, coverage, and claim records have been completely reset." });
});

// Serve frontend build static files in production
if (process.env.NODE_ENV === "production") {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
} else {
  // Vite integration in development
  createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  }).then((vite) => {
    app.use(vite.middlewares);
  });
}

// Start Server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`NOX Fullstack Server Running on http://localhost:${PORT}`);
});
