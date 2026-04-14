const users = {}; 
let adminSocketId = null;

io.on("connection", socket => {

  console.log("Client connected:", socket.id);

  /* USER REGISTER */
  socket.on("register session", ({ email, name }, ack) => {
    email = (email || "").toLowerCase().trim();

    if (!email || !name) {
      return ack?.({ success: false });
    }

    users[socket.id] = { name, email };

    if (adminSocketId) {
      io.to(adminSocketId).emit("new user", {
        userId: socket.id,
        name,
        email
      });
    }

    ack?.({ success: true });
  });

  /* USER → ADMIN */
  socket.on("chat message", text => {
    if (!users[socket.id]) return;
    if (!text || !text.trim()) return;

    const msg = {
      userId: socket.id,
      name: users[socket.id].name,
      text: text.trim()
    };

    if (adminSocketId) {
      io.to(adminSocketId).emit("chat message", msg);
    }
  });

  /* ADMIN REGISTER */
  socket.on("register admin", () => {
    adminSocketId = socket.id;

    const activeUsers = Object.entries(users).map(([id, u]) => ({
      userId: id,
      name: u.name,
      email: u.email
    }));

    io.to(adminSocketId).emit("current users", activeUsers);
  });

  /* ADMIN → USER */
  socket.on("chat to user", ({ userId, message }) => {
    if (!userId || !message) return;

    io.to(userId).emit("chat message", {
      userId: "admin",
      name: "Admin",
      text: message
    });
  });

  /* PUBLIC CHAT */
  socket.on("public message", msg => {
    io.emit("public message", msg);

    // ALSO SEND TO ADMIN
    if (adminSocketId) {
      io.to(adminSocketId).emit("chat message", {
        userId: socket.id,
        name: msg.name,
        text: msg.text
      });
    }
  });

  /* DISCONNECT */
  socket.on("disconnect", () => {
    delete users[socket.id];

    if (adminSocketId) {
      io.to(adminSocketId).emit("user disconnected", {
        userId: socket.id
      });
    }

    if (socket.id === adminSocketId) {
      adminSocketId = null;
    }

    console.log("Client disconnected:", socket.id);
  });

});
