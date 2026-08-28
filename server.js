require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

/* =========================================================
   EXPRESS SETUP
========================================================= */

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   SOCKET.IO SETUP
========================================================= */

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

/* =========================================================
   STATE
========================================================= */

const users = {};
const messages = {};

let adminSocketId = null;

/* =========================================================
   PUBLIC CHAT
========================================================= */

const PUBLIC_HISTORY_LIMIT = 200;

const publicMessages = [];

let nextPublicMsgId = 1;

/* =========================================================
   ADMIN KEY
========================================================= */

const ADMIN_KEY = process.env.ADMIN_KEY || "changeme";

function isValidAdminKey(key) {
  return typeof key === "string" && key === ADMIN_KEY;
}

/* =========================================================
   GOOGLE FEEDBACK SCRIPT
========================================================= */

/*
   Put your Google Apps Script URL in .env like:

   GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
*/

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

/* =========================================================
   FEEDBACK ENDPOINT
========================================================= */

app.post("/feedback", async (req, res) => {
  try {
    const name = req.body.name
      ? String(req.body.name).trim().slice(0, 100)
      : "Anonymous";

    const feedback = req.body.feedback
      ? String(req.body.feedback).trim().slice(0, 2000)
      : "";

    /* Validate feedback */

    if (!feedback) {
      return res.status(400).json({
        success: false,
        message: "Feedback is required."
      });
    }

    /* Make sure Google Script URL exists */

    if (!GOOGLE_SCRIPT_URL) {
      console.error("❌ GOOGLE_SCRIPT_URL is missing from .env");

      return res.status(500).json({
        success: false,
        message: "Feedback service is not configured."
      });
    }

    console.log("📝 New feedback received:");
    console.log("Name:", name);
    console.log("Feedback:", feedback);

    /*
       Send the data to Google Apps Script.

       We use URLSearchParams because your existing
       Google Apps Script expects form-style data:
       Name
       Feedback
    */

    const googleData = new URLSearchParams();

    googleData.append("Name", name);
    googleData.append("Feedback", feedback);

    const googleResponse = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: googleData.toString()
    });

    const googleText = await googleResponse.text();

    console.log("Google Script status:", googleResponse.status);
    console.log("Google Script response:", googleText);

    /*
       fetch() does not automatically throw for HTTP errors,
       so explicitly check the response.
    */

    if (!googleResponse.ok) {
      throw new Error(
        `Google Script returned HTTP ${googleResponse.status}`
      );
    }

    /* Success */

    return res.json({
      success: true,
      message: "Feedback submitted successfully."
    });

  } catch (error) {

    console.error("❌ Feedback submission error:");
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Failed to submit feedback."
    });
  }
});

/* =========================================================
   ONLINE USERS
========================================================= */

function broadcastOnlineUsers() {

  const list = Object.entries(users).map(([id, user]) => ({
    id,
    name: user.name,
    email: user.email,
    joined: user.joined,
    page: user.page
  }));

  io.emit("online users", list);
}

/* =========================================================
   SOCKET CONNECTION
========================================================= */

io.on("connection", (socket) => {

  console.log("Connected:", socket.id);

  /* =======================================================
     PUBLIC CHAT HISTORY
  ======================================================= */

  socket.emit("chat history", publicMessages);

  /* =======================================================
     USER REGISTER
  ======================================================= */

  socket.on("register session", ({ name, email } = {}, callback) => {

    if (!name || !email) {

      if (typeof callback === "function") {
        callback({
          success: false,
          message: "Missing details"
        });
      }

      return;
    }

    users[socket.id] = {
      name: String(name).trim(),
      email: String(email).trim(),
      joined: Date.now(),
      page: "Live Stream"
    };

    broadcastOnlineUsers();

    /* Tell admin about new user */

    if (adminSocketId) {

      io.to(adminSocketId).emit("new user", {
        userId: socket.id,
        name: users[socket.id].name,
        email: users[socket.id].email
      });

    }

    if (typeof callback === "function") {

      callback({
        success: true
      });

    }

  });

  /* =======================================================
     BABY NAME REVEAL
  ======================================================= */

  socket.on("reveal name", (name) => {

    if (!name) return;

    io.emit("show name", name);

  });

  /* =======================================================
     GET ONLINE USERS
  ======================================================= */

  socket.on("get online users", () => {

    const list = Object.entries(users).map(([id, user]) => ({
      id,
      name: user.name,
      email: user.email,
      joined: user.joined,
      page: user.page
    }));

    socket.emit("online users", list);

  });

  /* =======================================================
     PUBLIC CHAT
  ======================================================= */

  socket.on("public message", (data) => {

    const name = (
      data && data.name
        ? String(data.name)
        : "Guest"
    )
      .trim()
      .slice(0, 60);

    const text = (
      data && data.text
        ? String(data.text)
        : ""
    )
      .trim()
      .slice(0, 500);

    if (!text) return;

    const msg = {
      id: nextPublicMsgId++,
      userId: socket.id,
      name,
      text,
      time: Date.now()
    };

    publicMessages.push(msg);

    if (publicMessages.length > PUBLIC_HISTORY_LIMIT) {
      publicMessages.shift();
    }

    io.emit("public message", msg);

  });

  /* =======================================================
     ADMIN GET PUBLIC MESSAGES
  ======================================================= */

  socket.on(
    "admin get public messages",
    ({ key } = {}, callback) => {

      if (!isValidAdminKey(key)) {

        if (typeof callback === "function") {

          callback({
            success: false,
            message: "Invalid admin key"
          });

        }

        return;
      }

      if (typeof callback === "function") {

        callback({
          success: true,
          messages: publicMessages
        });

      }

    }
  );

  /* =======================================================
     ADMIN DELETE PUBLIC MESSAGES
  ======================================================= */

  socket.on(
    "admin delete public messages",
    ({ key, ids } = {}, callback) => {

      if (!isValidAdminKey(key)) {

        if (typeof callback === "function") {

          callback({
            success: false,
            message: "Invalid admin key"
          });

        }

        return;
      }

      const idSet = new Set(
        Array.isArray(ids) ? ids : []
      );

      if (idSet.size === 0) {

        if (typeof callback === "function") {

          callback({
            success: false,
            message: "No message ids provided"
          });

        }

        return;
      }

      for (
        let i = publicMessages.length - 1;
        i >= 0;
        i--
      ) {

        if (idSet.has(publicMessages[i].id)) {
          publicMessages.splice(i, 1);
        }

      }

      io.emit(
        "public messages deleted",
        Array.from(idSet)
      );

      if (typeof callback === "function") {

        callback({
          success: true,
          messages: publicMessages
        });

      }

    }
  );

  /* =======================================================
     ADMIN CLEAR PUBLIC CHAT
  ======================================================= */

  socket.on(
    "admin clear public chat",
    ({ key } = {}, callback) => {

      if (!isValidAdminKey(key)) {

        if (typeof callback === "function") {

          callback({
            success: false,
            message: "Invalid admin key"
          });

        }

        return;
      }

      publicMessages.length = 0;

      io.emit("public chat cleared");

      if (typeof callback === "function") {

        callback({
          success: true
        });

      }

    }
  );

  /* =======================================================
     USER -> ADMIN PRIVATE CHAT
  ======================================================= */

  socket.on("chat message", (text) => {

    if (!users[socket.id]) return;

    const msg = {
      userId: socket.id,
      name: users[socket.id].name,
      text: String(text || ""),
      from: "user"
    };

    if (!messages[socket.id]) {
      messages[socket.id] = [];
    }

    messages[socket.id].push(msg);

    if (adminSocketId) {

      io.to(adminSocketId).emit(
        "chat message",
        msg
      );

    }

  });

  /* =======================================================
     ADMIN REGISTER
  ======================================================= */

  socket.on("register admin", () => {

    adminSocketId = socket.id;

    const list = Object.entries(users).map(
      ([id, u]) => ({
        userId: id,
        name: u.name,
        email: u.email
      })
    );

    io.to(socket.id).emit(
      "current users",
      list
    );

    broadcastOnlineUsers();

  });

  /* =======================================================
     ADMIN -> USER PRIVATE CHAT
  ======================================================= */

  socket.on(
    "chat to user",
    ({ userId, message } = {}) => {

      if (!userId || !message) return;

      const msg = {
        userId: "admin",
        name: "Admin",
        text: String(message),
        from: "admin"
      };

      if (!messages[userId]) {
        messages[userId] = [];
      }

      messages[userId].push(msg);

      io.to(userId).emit(
        "chat message",
        msg
      );

    }
  );

  /* =======================================================
     PRIVATE CHAT HISTORY
  ======================================================= */

  socket.on("get history", (userId) => {

    socket.emit(
      "history",
      messages[userId] || []
    );

  });

  /* =======================================================
     EMERGENCY POPUP
  ======================================================= */

  socket.on(
    "send popup",
    ({ title, message } = {}) => {

      if (!title || !message) return;

      const cleanTitle = String(title)
        .trim()
        .slice(0, 200);

      const cleanMessage = String(message)
        .trim()
        .slice(0, 2000);

      if (!cleanTitle || !cleanMessage) return;

      io.emit("show popup", {
        title: cleanTitle,
        message: cleanMessage,
        time: Date.now()
      });

      console.log(
        "🚨 Popup sent:",
        cleanTitle
      );

    }
  );

  /* =======================================================
     DISCONNECT
  ======================================================= */

  socket.on("disconnect", () => {

    console.log("Disconnected:", socket.id);

    delete users[socket.id];

    broadcastOnlineUsers();

    if (adminSocketId) {

      io.to(adminSocketId).emit(
        "user disconnected",
        {
          userId: socket.id
        }
      );

    }

    if (socket.id === adminSocketId) {

      adminSocketId = null;

    }

  });

});

/* =========================================================
   BASIC SERVER TEST
========================================================= */

app.get("/", (req, res) => {

  res.json({
    success: true,
    message: "Guess The Name server is running."
  });

});

/* =========================================================
   START SERVER
========================================================= */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

  console.log(
    `🚀 Server running on port ${PORT}`
  );

  console.log(
    "Feedback endpoint: /feedback"
  );

});
