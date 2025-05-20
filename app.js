require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const methodOverride = require("method-override");
const admin = require("firebase-admin");    


const app = express();

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public")); // For serving static files like CSS
app.use(express.json());
app.use(cookieParser()); 
app.use(methodOverride("_method")); 
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));



                /////////////////////////////* *FileStorage-SetUp **//////////////////////////////////////
// Multer Storage Setup

// File & Profile Picture Upload 
const profileStorage = multer.diskStorage({
    destination: "uploads/profile_pictures/",
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const storage = multer.diskStorage({
    destination: "uploads/",
    filename: function (req, file, cb) {
        // Avoid overwriting by adding a timestamp prefix
        const timestamp = Date.now();
        const sanitizedOriginalName = file.originalname.replace(/\s+/g, '_');
        cb(null, `${timestamp}-${sanitizedOriginalName}`);
    }
});

const uploadProfilePicture = multer({ storage: profileStorage })

const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        const allowedExtensions = [
            '.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx',
            '.ppt', '.pptx', '.csv', '.jpg', '.jpeg', '.png',
            '.gif', '.zip', '.rar', '.7z'
        ];

        const ext = path.extname(file.originalname).toLowerCase();

        if (allowedExtensions.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error("File type not allowed. Please upload a valid document or image file."));
        }
    }
});

                 /////////////////////////////* *DataBase-SetUp **//////////////////////////////////////
// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI);

// User Schema
const userSchema = new mongoose.Schema({
    username: String,
    email: String,
    password: String,
    profilePicture: { type: String, default: "" },
    fullName: { type: String, default: "" },
    role: { type: String, default: "" },
    phone: { type: String, default: "" },
    bio: { type: String, default: "" },
    resetCode:  { type: String, default: "" },  // Stores the verification code
    resetCodeExpiry:  { type: Date, default: "" },
    fcmToken: { type: String },
    createdAt: { type: Date, default: Date.now },
    notifications: {
      push: { type: Boolean, default: true },
     }
});
const User = mongoose.model("User", userSchema);

const goalSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    title: { type: String, required: true },
    deadline: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
});
const Goal = mongoose.model("Goal", goalSchema)

// State Schema
const stateSchema = new mongoose.Schema({
    name: String,
    files: [{ name: String, path: String}]
});
const State = mongoose.model("State", stateSchema);

//File Schema
const fileSchema = new mongoose.Schema({
    name: String,
    filename: String,
    category: String,  // Correspondence, Drawings, Proposals, Reports
    state: String,
}, { timestamps: true });
const File = mongoose.model("File", fileSchema);

// Project Schema
const subStageSchema = new mongoose.Schema({
    name: String,
    duration: String,
    progress: {
        type: Number,
        default: 0 // initial progress
      }
  });
  
const mainStageSchema = new mongoose.Schema({
    name: String,
    subStages: [subStageSchema]
  });
  
const projectSchema = new mongoose.Schema({
    name: String,
    location: String,
    mainStageList: [mainStageSchema],
    createdAt: {
        type: Date,
        default: Date.now
      }
  });
  
const Project = mongoose.model("Project", projectSchema);

// **Middleware for Authentication**
const authMiddleware = async (req, res, next) => {
    const token = req.cookies.token || req.header("Authorization") ; // Get token from cookie
    if (!token) return res.redirect("/login");
    // if (!token) return res.re(401).send("Access Denied");
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id);
        if (!req.user) return res.redirect("/register");
        next();
    } catch (err) {
        res.status(400)
        // .send("Session expired, Please Login again.");
        res.redirect("/login")
    }
};

               /////////////////////////////* *Routes-SetUp **//////////////////////////////////////

// **Home Route**
app.get("/", (req, res) => {
    res.render("home");
});

// **Register Route**
app.get("/register", (req, res) => {
    res.render("register");
});

app.post("/register", async (req, res) => {
    const { username, email, password, passwordMatch } = req.body;

    if (password !== passwordMatch) {
        return res.send("Passwords do not match!");
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({ username, email, password: hashedPassword });
    await newUser.save();

    res.redirect("/login");
});

// Push Notification Handler.

app.post("/save-token", authMiddleware, async (req, res) => {
    
    const { token } = req.body;
    const userId = req.user._id;
    // const userId = req.user.id; // Assuming user is authenticated
  
    try {
      await User.findByIdAndUpdate(userId, { fcmToken: token });
    //   res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Could not save token" });
    }
  });

// Firebase Admin SDK Initialization
admin.initializeApp({
  credential: admin.credential.cert({
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
    universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN
  }),
});
  
  const sendPushNotification = async (token, title, body) => {
    const message = {
      notification: { title, body },
      token: token
    };
  
    try {
      await admin.messaging().send(message);
      console.log("✅ Push sent");
    } catch (error) {
      console.error("❌ Error sending push", error);
    }
  };

// **Login Route**
app.get("/login", (req, res) => {
    res.render("login");
});

app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    // check if username is valid
    if(!user || (username !== user.username)){
        return res.status(400).send("User not registered!")
    }

    // check if password is valid
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).send("Incorrect Password");
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "5h" });

    res.cookie("token", token, { httpOnly: true, secure: true, sameSite: "Strict" });
    res.redirect("/dashboard");
});

// Forgot Password?
app.get("/forgetPassword", async(req, res) =>{
    res.render("forgetPassword")
})
app.get("/verifyPassword", async(req, res) =>{
    res.render("verifyPassword")
})
app.get("/resetPassword", async(req, res) =>{
    res.render("resetPassword")
})

// Form Action For Changing Password. 
app.post("/forgot-password", async (req, res) => {
  
    const user = await User.findOne({ email: req.body.email }).exec();;
    if (!user) {
        return res.status(404).send("No account found with this email.");
    }

    // Generate a 6-digit verification code
    const verificationCode = crypto.randomInt(100000, 999999).toString();
    const expiryTime = Date.now() + 5 * 60 * 1000; // Code valid for 10 minutes


    user.resetCode = verificationCode;
    user.resetCodeExpiry = expiryTime;

    console.log(verificationCode,  expiryTime)

    await user.save();

    // Configure Email Transport
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.MAIL_FROM,
            pass: process.env.MAIL_FROM_PASS
        },
    });

    const mailOptions = {
        from: process.env.MAIL_FROM,
        to: user.email,
        subject: "Password Reset Code",
        text: `Hi,
                Your one-time verification code: 
                 ${verificationCode}. 
                 This code expires after 5 minutes. 
                 If you did not request this, please contact Bolcon Support.`,
    };

    await transporter.sendMail(mailOptions);

    console.log("Verification code sent to your email.");
    res.redirect("/verifyPassword")
});
// Verify Password

app.post("/verify-code", async (req, res) => {
    const { email, code } = req.body;

    const user = await User.findOne({ email });

    if (!user || user.resetCode !== code) {
        return res.status(400).send("Invalid verification code.");
    }

    if (Date.now() > user.resetCodeExpiry) {
        return res.status(400).send("Verification code has expired.");
    }

    console.log("Code verified. Proceed to reset your password.");
    res.redirect("/resetPassword")
});


//Reset Password
app.post("/reset-password", async (req, res) => {
    const { username, newPassword, newPassword2 } = req.body;

    const user = await User.findOne({ username });
    if (!user) return res.status(404).send("User not found.");

    if (newPassword !== newPassword2) return res.status(404).send("Password is not a match!");

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.resetCode = null;
    user.resetCodeExpiry = null;
    await user.save();

    res.redirect("/login");
});


//Dashboard Route

app.get("/dashboard", authMiddleware, async(req, res) => {
    const user = await User.findById(req.user.id);

    const projects = await Project.find({}).sort({ _id: -1 })

    const goals = await Goal.find({ userId: req.user._id }).sort({ deadline: 1 });


    let completed = 0;
    let ongoing = 0;
    let pending = 0;

    projects.forEach(project => {
      let totalStages = 0;
      let totalCompleted = 0;
      let totalStarted = 0;

      project.mainStageList.forEach(mainStage => {
        if (mainStage.subStages && mainStage.subStages.length > 0) {
          mainStage.subStages.forEach(sub => {
            totalStages++;
            if (sub.progress && sub.progress > 0) totalStarted++;
            if (sub.progress === 100) totalCompleted++;
          });
        }
      });

      if (totalStages === 0) {
        pending++;
      } else if (totalCompleted === totalStages) {
        completed++;
      } else if (totalStarted > 0) {
        ongoing++;
      } else {
        pending++;
      }
    });


    if (!user) return res.status(404).send("User not found");
    res.render("dashboard", { user, 
        projects,
        goals, 
        completed, ongoing, pending });
});

// Add Goal Route.
app.post("/goals", authMiddleware, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  
      const { title, deadline } = req.body;
      const newGoal = new Goal({
        userId: req.user._id,
        title,
        deadline,
        createdAt: new Date()
      });
  
      const savedGoal = await newGoal.save();
      res.status(201).json(savedGoal);
    } catch (err) {
      console.error("Error saving goal:", err.message);
      res.status(500).json({ error: "Server error" });
    }
  });
  

app.delete("/goals/:id", async (req, res) => {
    try {
      await Goal.findByIdAndDelete(req.params.id);
      res.status(200).json({ message: "Goal deleted" });
    } catch (err) {
      res.status(500).json({ error: "Delete failed" });
    }
  });
// Notification for Goal Deadline
cron.schedule("0 0 * * *", async () => {
    const now = new Date();
    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const endOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  
    const goals = await Goal.find({
      deadline: { $gte: startOfTomorrow, $lt: endOfTomorrow },
    });
  
    for (const goal of goals) {
      const user = await User.findById(goal.userId);
      if (user.notifications.push && user?.fcmToken) {
        const message = {
          notification: {
            title: "⏰ Goal Deadline Reminder",
            body: `Your goal "${goal.title}" is due tomorrow.`,
          },
          token: user.fcmToken,
        };
  
        try {
          await admin.messaging().send(message);
          console.log(`✅ Sent reminder to user ${user._id}`);
        } catch (err) {
          console.error(`❌ Failed to send to user ${user._id}:`, err.message);
        }
      }
    }
  });

// Delete Goal Route
app.delete("/goals/:id", async (req, res) => {
    try {
      if (!req.user) return res.status(401).send("Unauthorized");
  
      await Goal.deleteOne({ _id: req.params.id, userId: req.user._id });
      res.redirect("/goals");
    } catch (err) {
      console.error("Error deleting goal:", err.message);
      res.status(500).send("Server Error");
    }
  });

// Project Route
app.get("/project", authMiddleware, async (req, res) => {
    const user = await User.findById(req.user.id);

    if (!user) return res.status(404).send("User not found");
   
    res.render("project", {user});
});

// Save project route
app.post('/saveProject', authMiddleware, async (req, res) => {

  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).send("User not found");
  
    try {
      const { name, location, mainStageList } = req.body;
  
      if (!name || !location || !mainStageList || mainStageList.length === 0) {
        return res.status(400).json({ message: 'Invalid project data' });
      }
  
      const newProject = new Project({
        name,
        location,
        mainStageList
      });
  
      await newProject.save();

      if (user.notifications.push && user?.fcmToken) {
        await sendPushNotification(
          user.fcmToken,
          "📁 New Project Created",
          `Your project "${name}" has been successfully created.`
        );
      }

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Error saving project:', error);
      res.status(500).json({ message: 'Server error while saving project' });
    }
  });

// Track Project Details Route
// For viewing the update-progress page
app.get('/project/:id/update-progress', async (req, res) => {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) {
        return res.status(404).send('Project not found');
      }
      res.render('trackProgress', { project });
    } catch (err) {
      console.error(err);
      res.status(500).send('Server Error');
    }
  });
  

app.get('/api/projects', async (req, res) => {
    const projects = await Project.find().sort({ createdAt: -1 });
    res.json(projects);
  });
  
app.post('/project/:id/update-progress', async (req, res) => {
    const projectId = req.params.id;
    const updatedProgress = req.body.progress;
  
    try {
      const project = await Project.findById(projectId);
      if (!project) return res.status(404).send('Project not found');
  
      // Update progress for each sub-stage
      project.mainStageList.forEach((mainStage, mainIndex) => {
        const subStages = mainStage.subStages;
        if (!subStages) return;
  
        subStages.forEach((subStage, subIndex) => {
          const progressValue = updatedProgress?.[mainIndex]?.[subIndex];
          if (progressValue !== undefined) {
            subStage.progress = parseInt(progressValue); // store progress
          }
        });
      });
  
      // Save project with updated progress values
      await project.save();
      res.redirect(`/dashboard`); // or wherever you want to go next
  
    } catch (error) {
      console.error('Error updating progress:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  app.post('/project/:id/delete', async (req, res) => {
    try {
      const projectId = req.params.id;
  
      const deletedProject = await Project.findByIdAndDelete(projectId);
  
      if (!deletedProject) {
        return res.status(404).send('Project not found');
      }
  
      res.redirect('/dashboard');
    } catch (error) {
      console.error('Error deleting project:', error);
      res.status(500).send('Error deleting project');
    }
  });
  
  

// **Create State Route**
app.get("/createState", authMiddleware, async (req, res) => {
    const states = await State.find();
    res.render("createState", { states });
});

app.post("/createState", authMiddleware, async (req, res) => {
        const { stateName,  userName } = req.body;

        if (!stateName) {
            return res.status(400).send("State name is required.");
        }

        const user = await User.findById(req.user.id);
            if (userName !== user.username) {
                return res.status(403).send("You are not a registered user.");
            }

        const existingState = await State.findOne({ name: stateName });
        if (existingState) {
            return res.status(400).send("State already exists.");
        }

        const newState = new State({ name: stateName, files: [] });
        await newState.save();

        res.redirect("/createState");
});

//Create Category Project
app.get("/document/:stateName/:category", async (req, res) => {
    const { stateName, category } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;
  
    const state = await State.findOne({ name: stateName });
    if (!state) return res.status(404).send("State not found");
  
    const totalFiles = await File.countDocuments({ state: stateName, category });
    const filteredFiles = await File.find({ state: stateName, category })
                                    .sort({ createdAt: -1 }) // latest first
                                    .skip(skip)
                                    .limit(limit);
  
    const totalPages = Math.ceil(totalFiles / limit);
  
    res.render("category", {
        state,
        category,
        files: filteredFiles,
        currentPage: page,
        totalPages
    });
  });

app.post("/upload", authMiddleware, upload.single("file"), async (req, res) => {
    
    if (!req.file) {
        return res.status(400).send("No file uploaded.");
    }
        const { stateName, category } = req.body;

    if (!stateName || !category) {
        return res.status(400).send("State and category are required.");
    }

    // const user = await User.findOne({username});
    // if (!user) {
    //     return res.status(400).send("You are not an authorized user.");
    // }

    const state = await State.findOne({ name: stateName });
    if (!state) {
        return res.status(404).send("State not found.");
    }
    // req.body.fileName
    const newFile = new File({
        name: req.body.customName,
        filename: req.file.filename, 
        multerFilename: req.file.originalname,
        category,
        uploadDate: new Date(),
        state: stateName
    });

    await newFile.save();

    const user = await User.findById(req.user._id);

    const filenameNote = req.body.customName;

    // Send push notification if user has a token
    if (user.notifications.push && user?.fcmToken) {
      await sendPushNotification(
        user.fcmToken,
        "📄 New Document Uploaded",
        `Your document "${filenameNote}" has been successfully added.`
      );
    }

    state.files.push(newFile);
    await state.save();

    res.redirect(`/document/${stateName}`);
});

//Document upload Route
app.get("/document/:stateName", async (req, res) => {
    const state = await State.findOne({ name: req.params.stateName }).populate("files");
    if (!state) {
        return res.status(404).send("State not found");
    }
    const recentFiles = state.files.slice(-5).reverse();  // Get the last 5 files.
    
    // console.log(recentFiles)
    res.render("document", { state, recentFiles });
});

//Document Delete Route
app.post("/delete-file/:id", async (req, res) => {
  try {
      const file = await File.findById(req.params.id);
      if (!file) return res.status(404).send("File not found");

    
      const filePath = `uploads/${file.filename}`;
      
      // Delete the file from the filesystem
      fs.unlink(filePath, async (err) => {
          if (err) console.error("File system deletion error:", err);
          
          // Delete metadata from MongoDB
          await File.findByIdAndDelete(req.params.id);
        //   res.redirect("back");
         res.redirect(`/document/${file.state}/${file.category}`)
      });
  } catch (err) {
      console.error(err);
      res.status(500).send("Server error");
  }
});

// Account Settings Route
app.get("/account", authMiddleware, async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).send("User not found");
    res.render("account", { user });
});
// Update Account Profile
app.post("/account", authMiddleware, uploadProfilePicture.single("profilePicture"), async (req, res) => {
    const { fullName, role, phone, bio, email } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).send("User not found");

    user.fullName = fullName || user.fullName;
    user.role = role || user.role;
    user.phone = phone || user.phone;
    user.bio = bio || user.bio;
    user.email = email || user.email;
    if (req.file) user.profilePicture = `/uploads/profile_pictures/${req.file.filename}`;

    await user.save();
    res.redirect("/profile");
});

// Update Push Notification Setting
app.post("/account/push-notifications", authMiddleware, async (req, res) => {

try {
    const userId = req.user._id; //  auth middleware sets req.user
    const { push } = req.body;

    await User.findByIdAndUpdate(userId, {
      'notifications.push': push
    });

    res.json({ success: true, message: `Push notifications ${push ? 'enabled' : 'disabled'}.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error updating push setting.' });
  }

});

// Account Profile Router.
app.get("/profile", authMiddleware, async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).send("User not found");
    res.render("profile", { user });
});
// Delete Account Route
app.get("/delete", authMiddleware, async (req, res) => {
    try {
        const userId = req.user._id; // Get user ID from authentication
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).send("User not found");
        }

        // If user has a profile picture, delete it
        if (user.profilePicture) {
            const profilePicPath = path.join(__dirname,  user.profilePicture);
            fs.unlink(profilePicPath, (err) => {
                if (err) console.error("Error deleting profile picture:", err);
            });
        }

        // Delete user from database
        await User.findByIdAndDelete(userId);
        res.redirect("/logout")
        
    } catch (error) {
        console.error("Error deleting account:", error);
        res.status(500).send("Server error");
    }
});

// **Logout Route**
app.get("/logout", (req, res) => {
    res.clearCookie("token");
    res.redirect("/");
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
