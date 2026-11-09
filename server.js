
require("dotenv").config();

const express = require("express");
const session = require("cookie-session");
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

// Render runs behind a reverse proxy. Trust it so secure session cookies
// are correctly set and returned over HTTPS.
app.set("trust proxy", 1);

// =====================================
// CONFIGURATION
// =====================================

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || "./data";
const DATA_FILE = path.join(DATA_DIR, "cleaning-records.json");

const MEMBERS = ["ABBAS", "YASEEN", "ILLAH"];

const TASKS = {
  bathroom: [
    "Clean toilet",
    "Clean sink and mirror",
    "Clean shower and bathtub",
    "Mop bathroom floor",
    "Empty bathroom trash"
  ],
  trash: [
    "Remove kitchen trash",
    "Replace trash bag",
    "Take out recycling",
    "Spray for bugs"
  ]
};

// =====================================
// ENVIRONMENT VALIDATION
// =====================================

if (!process.env.PORTAL_PASSWORD || !process.env.SESSION_SECRET) {
  throw new Error(
    "PORTAL_PASSWORD and SESSION_SECRET must be configured."
  );
}

if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
  console.warn(
    "WARNING: Gmail credentials are missing. Email functionality is disabled."
  );
}

// =====================================
// DATA STORAGE
// =====================================

fs.mkdirSync(DATA_DIR, { recursive: true });

function readRecords() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];

    return JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );
  } catch (error) {
    console.error("Could not read cleaning records:", error);
    return [];
  }
}

function saveRecords(records) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(records, null, 2)
  );
}

// =====================================
// EXPRESS MIDDLEWARE
// =====================================

app.use(express.json());

app.use(
  session({
    name: "home-harmony-session",
    keys: [process.env.SESSION_SECRET],
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
  })
);

// =====================================
// LOGIN
// =====================================

app.post("/api/login", (req, res) => {
  const { password } = req.body || {};

  const suppliedHash = crypto
    .createHash("sha256")
    .update(typeof password === "string" ? password : "")
    .digest();

  const correctHash = crypto
    .createHash("sha256")
    .update(process.env.PORTAL_PASSWORD)
    .digest();

  if (
    typeof password !== "string" ||
    password.length > 200 ||
    !crypto.timingSafeEqual(suppliedHash, correctHash)
  ) {
    return res.status(401).json({
      error: "Incorrect password."
    });
  }

  req.session.authenticated = true;

  res.json({ success: true });
});

// =====================================
// CHECK SESSION
// =====================================

app.get("/api/session", (req, res) => {
  res.json({
    authenticated: !!req.session?.authenticated
  });
});

// =====================================
// PROTECT API ROUTES
// =====================================

app.use("/api", (req, res, next) => {
  if (!req.session?.authenticated) {
    return res.status(401).json({
      error: "Please log in."
    });
  }

  next();
});

// =====================================
// LOGOUT
// =====================================

app.post("/api/logout", (req, res) => {
  req.session = null;

  res.json({ success: true });
});

// =====================================
// MEMBERS AND TASK OPTIONS
// =====================================

app.get("/api/config", (req, res) => {
  res.json({
    members: MEMBERS,
    tasks: TASKS
  });
});

// =====================================
// CLEANING HISTORY
// =====================================

app.get("/api/records", (req, res) => {
  res.json(readRecords());
});

// =====================================
// SAVE CLEANING ACTIVITY
// =====================================

app.post("/api/records", (req, res) => {
  const {
    member,
    category,
    date,
    time,
    tasks,
    notes
  } = req.body || {};

  if (!MEMBERS.includes(member)) {
    return res.status(400).json({
      error: "Invalid member."
    });
  }

  if (!Object.hasOwn(TASKS, category)) {
    return res.status(400).json({
      error: "Invalid cleaning category."
    });
  }

  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(`${date}T00:00:00`))
  ) {
    return res.status(400).json({
      error: "Enter a valid date."
    });
  }

  if (
    typeof time !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  ) {
    return res.status(400).json({
      error: "Enter a valid time."
    });
  }

  if (
    !Array.isArray(tasks) ||
    tasks.length === 0 ||
    tasks.some(task => !TASKS[category].includes(task))
  ) {
    return res.status(400).json({
      error: "Select at least one valid task."
    });
  }

  if (
    typeof notes !== "string" ||
    notes.length > 500
  ) {
    return res.status(400).json({
      error: "Notes must be 500 characters or fewer."
    });
  }

  const records = readRecords();

  const record = {
    id: crypto.randomUUID(),
    member,
    category,
    date,
    time,
    tasks,
    notes: notes.trim(),
    createdAt: new Date().toISOString()
  };

  records.unshift(record);
  saveRecords(records);

  res.status(201).json(record);
});

// =====================================
// GMAIL CONFIGURATION
// =====================================

function createEmailTransporter() {
  if (
    !process.env.EMAIL_USER ||
    !process.env.EMAIL_APP_PASSWORD
  ) {
    throw new Error(
      "EMAIL_USER or EMAIL_APP_PASSWORD is missing in .env."
    );
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD.replace(/\s/g, "")
    }
  });
}

// =====================================
// SEND BATHROOM REMINDER
// =====================================

async function sendBathroomReminder(testMode = false) {
  try {
    const transporter = createEmailTransporter();

    const recipients = testMode
      ? [process.env.EMAIL_TEST_TO || process.env.EMAIL_USER]
      : (process.env.REMINDER_EMAILS || process.env.EMAIL_USER)
          .split(",")
          .map(email => email.trim())
          .filter(Boolean);

    const subject = "Bathroom Cleaning Reminder – Due Tuesday";

    const text = `
Hello,

This is a friendly reminder to please complete the bathroom cleaning tasks by Tuesday.

Tasks to be completed:

- Clean the toilet
- Clean the sink and mirror
- Clean the shower and bathtub
- Mop the bathroom floor
- Empty the bathroom trash

Once all tasks are completed, please update their status in the Homecare portal.

Thank you for your cooperation and for helping us maintain a clean, comfortable living environment.

Homecare Team
`;

    const html = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px;">
        <h2 style="color: #2563eb;">Bathroom Cleaning Reminder</h2>

        <p>Hello,</p>

        <p>
          This is a friendly reminder to please complete the bathroom
          cleaning tasks by <strong>Tuesday</strong>.
        </p>

        <p><strong>Tasks to be completed:</strong></p>

        <ul>
          <li>Clean the toilet</li>
          <li>Clean the sink and mirror</li>
          <li>Clean the shower and bathtub</li>
          <li>Mop the bathroom floor</li>
          <li>Empty the bathroom trash</li>
        </ul>

        <p>
          Once all tasks are completed, please update their status
          in the <strong>Homecare portal</strong>.
        </p>

        <p>
          Thank you for your cooperation and for helping us maintain
          a clean, comfortable living environment.
        </p>

        <p style="margin-top: 25px;">
          Best regards,<br />
          <strong>Homecare Team</strong>
        </p>
      </div>
    `;

    const info = await transporter.sendMail({
      from: `"Homecare" <${process.env.EMAIL_USER}>`,
      to: recipients.join(","),
      subject,
      text,
      html
    });

    console.log("Homecare reminder sent:", info.messageId);

    return {
      success: true,
      messageId: info.messageId
    };

  } catch (error) {
    console.error("Homecare email error:", error.message);

    return {
      success: false,
      error: error.message
    };
  }
}

// =====================================
// TEST EMAIL API
// =====================================

app.post("/api/test-email", async (req, res) => {
  const result = await sendBathroomReminder(true);

  if (!result.success) {
    return res.status(500).json(result);
  }

  res.json({
    success: true,
    message: "Test email sent successfully through Gmail.",
    messageId: result.messageId
  });
});

// =====================================
// WEEKLY AUTOMATIC REMINDER
// Every Sunday at 9 AM Chicago time
// =====================================

cron.schedule(
  "0 9 * * 0",
  async () => {
    console.log("Running weekly bathroom reminder...");

    const result = await sendBathroomReminder(false);

    if (!result.success) {
      console.error("Weekly reminder failed:", result.error);
    }
  },
  {
    timezone: "America/Chicago"
  }
);

// =====================================
// SERVE FRONTEND
// =====================================

app.use(express.static(path.join(__dirname, "public")));

// =====================================
// START SERVER
// =====================================

app.listen(PORT, () => {
  console.log("--------------------------------");
  console.log("HOME HARMONY STARTED");
  console.log(`Portal: http://localhost:${PORT}`);
  console.log("Email provider: Gmail SMTP");
  console.log("Weekly reminder: Sunday 9 AM Chicago");
  console.log("--------------------------------");
});
