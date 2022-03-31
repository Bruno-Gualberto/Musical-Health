const express = require("express");
const app = express();
const compression = require("compression");
const path = require("path");
const db = require("../database/db");
const cookieSession = require("cookie-session");
// const { hash, compare } = require("./bc");
// const cryptoRandomString = require("crypto-random-string");

const server = require("http").Server(app);
const io = require("socket.io")(server, {
    allowRequest: (req, callback) =>
        callback(null, req.headers.referer.startsWith("http://localhost:3000")),
});

const cookieSessionMiddleware = cookieSession({
    secret: process.env.SECRET || `I'm always angry.`,
    maxAge: 1000 * 60 * 60 * 24 * 14,
});

const multer = require("multer");
const uidSafe = require("uid-safe");

const s3 = require("./s3");

const diskStorage = multer.diskStorage({
    destination: function (req, file, callback) {
        callback(null, path.join(__dirname, "uploads"));
    },
    filename: function (req, file, callback) {
        uidSafe(24).then((uid) => {
            callback(null, uid + path.extname(file.originalname));
        });
    },
});

const uploader = multer({
    storage: diskStorage,
    limits: {
        fileSize: 2097152,
    },
});

app.use(compression());

app.use(cookieSessionMiddleware);
io.use(function (socket, next) {
    cookieSessionMiddleware(socket.request, socket.request.res, next);
});

app.use(express.json());

app.use(express.static(path.join(__dirname, "..", "client", "public")));

app.get("/user/id.json", async (req, res) => {
    res.json({ userId: req.session.userId, doctor: req.session.doctor });
});

app.post("/add-doctor.json", async (req, res) => {
    // const query = await db.addDoctor();
    const query = await db.fakeLoginDoctor();
    const { rows } = query;
    req.session.userId = rows[0].id;
    req.session.doctor = rows[0].doctor;
    console.log("rows[0]", rows[0]);
    res.json(rows[0]);
});

app.post("/add-user.json", async (req, res) => {
    // const query = await db.addUser();
    const query = await db.fakeLoginUser();
    const { rows } = query;
    req.session.userId = rows[0].id;
    req.session.doctor = rows[0].doctor;
    console.log("rows[0]", rows[0]);
    res.json(rows[0]);
});

app.get("/user.json", async (req, res) => {
    try {
        if (req.session.doctor === true) {
            const query = await db.getDoctorById(req.session.userId);
            const { rows } = query;
            return res.json(rows[0]);
        } else if (req.session.doctor === false) {
            const query = await db.getUserById(req.session.userId);
            const { rows } = query;
            return res.json(rows[0]);
        }
    } catch (err) {
        console.log("error on GET user.json: ", err);
    }
});

app.get("/articles.json", async (req, res) => {
    try {
        const query = await db.getArticles();
        const { rows } = query;
        res.json(rows);
    } catch (err) {
        console.log("error on GET /articles.json: ", err);
    }
});

app.get("/more-articles/:smallestId.json", async (req, res) => {
    try {
        const smallestId = parseInt(req.params.smallestId);
        const query = await db.getMoreArticles(smallestId);
        const { rows } = query;
        res.json(rows);
    } catch (err) {
        console.log("error on GET /more-articles/:smallestId.json: ", err);
    }
});

app.get("/single-article/:articleId.json", async (req, res) => {
    try {
        const articleId = parseInt(req.params.articleId);
        const query = await db.getSingleArticle(articleId);
        const { rows } = query;
        res.json(rows[0]);
    } catch (err) {
        console.log("error on GET /single-article/:articleId.json", err);
    }
});

app.get("/doctor/:doctorId.json", async (req, res) => {
    try {
        const doctorId = parseInt(req.params.doctorId);
        const ownProfile =
            req.session.doctor && doctorId === req.session.userId;
        const query = await db.getDoctorById(doctorId);
        const { rows } = query;
        return res.json({ doctorInfo: rows[0], ownProfile });
    } catch (err) {
        console.log("error on GET /doctor/:doctorId.json", err);
    }
});

app.get("/doctor-articles/:doctorId.json", async (req, res) => {
    try {
        const doctorId = parseInt(req.params.doctorId);
        const query = await db.getDoctorArticles(doctorId);
        const { rows } = query;
        res.json(rows);
    } catch (err) {
        console.log("error on GET /doctor-articles/:doctorId.json", err);
    }
});

app.get(
    "/more-doctor-articles/:doctorId/:smallestId.json",
    async (req, res) => {
        try {
            const smallestId = parseInt(req.params.smallestId);
            const doctorId = parseInt(req.params.doctorId);
            const query = await db.getMoreDoctorArticles(doctorId, smallestId);
            const { rows } = query;
            res.json(rows);
        } catch (err) {
            console.log(
                "error on GET /more-doctor-articles/:smallestId.json",
                err
            );
        }
    }
);

// ADD NEW ARTICLE WITH PICTURE

function hasAllFields(req, res, next) {
    let { title, subtitle, text } = req.body;
    if (!title || !subtitle || !text) {
        return res.json({
            error: "You must fill in all fields to publish an article.",
        });
    } else {
        next();
    }
}

app.post(
    "/add-new-article.json",
    uploader.single("file"),
    hasAllFields,
    s3.upload,
    async (req, res) => {
        let { title, subtitle, text } = req.body;
        // title, subtitle and text are in req.body
        let url = `https://s3.amazonaws.com/buckethealthformusic/${req.file.filename}`;
        // the url must be:
        // `https://s3.amazonaws.com/Name-BUCKET/${req.file.filename}`
        try {
            const query = await db.addArticle(
                req.session.userId,
                title,
                subtitle,
                text,
                url
            );
            const { rows } = query;
            return res.json(rows[0]);
        } catch (err) {
            console.log("error on POST /add-new-article.json", err);
            return res.sendStatus(500);
        }
    }
);

app.get("/edit-article/:articleId", async (req, res) => {
    const articleId = parseInt(req.params.articleId);

    try {
        const query = await db.getArticleForEdit(articleId);
        const { rows } = query;
        res.json(rows[0]);
    } catch (err) {
        console.log("error on GET /edit-article/:articleId", err);
    }
});

app.post(
    "/edit-article-with-pic.json",
    uploader.single("file"),
    hasAllFields,
    s3.upload,
    async (req, res) => {
        let { title, subtitle, text } = req.body;
        const articleId = parseInt(req.body.articleId);

        let url = `https://s3.amazonaws.com/buckethealthformusic/${req.file.filename}`;
        try {
            const query = await db.updateArticleWithPic(
                articleId,
                title,
                subtitle,
                text,
                url
            );
            const { rows } = query;
            return res.json(rows[0]);
        } catch (err) {
            console.log("error on POST /edit-article-with-pic.json", err);
            return res.sendStatus(500);
        }
    }
);

app.post("/edit-article-text.json", hasAllFields, async (req, res) => {
    let { title, subtitle, text, articleId } = req.body;
    articleId = parseInt(articleId);
    try {
        const query = await db.updateArticleText(
            articleId,
            title,
            subtitle,
            text
        );
        const { rows } = query;
        return res.json(rows[0]);
    } catch (err) {
        console.log("error on POST /edit-article-text.json", err);
        return res.sendStatus(500);
    }
});

app.get("/logout", (req, res) => {
    delete req.session.userId;
    delete req.session.doctor;
    return res.redirect("/");
});

app.get("*", function (req, res) {
    res.sendFile(path.join(__dirname, "..", "client", "index.html"));
});

server.listen(process.env.PORT || 3001, function () {
    console.log("I'm listening.");
});

// const privateChatIds = {};

// io.on("connection", async (socket) => {
//     if (!socket.request.session.userId) {
//         return socket.disconnect(true);
//     }

//     const userId = socket.request.session.userId;

//     privateChatIds[socket.id] = userId;
//     console.log("privateChatIds", privateChatIds);

//     const { rows: allPrivMsgs } = await db.getPrivateMsgs(userId);
//     socket.emit("allPrivMsgs", allPrivMsgs);

//     socket.on("newPrivMsg", ({ newPrivMsg, friendId }) => {
//         db.addNewPrivMsg(newPrivMsg, userId, friendId)
//             .then(({ rows }) => {
//                 for (const prop in privateChatIds) {
//                     if (privateChatIds[prop] === friendId) {
//                         io.to(prop).emit("receivedNewPrivMsg", rows[0]);
//                     }
//                 }
//                 socket.emit("receivedNewPrivMsg", rows[0]);
//             })
//             .catch((err) => console.log("error oon new private message", err));
//     });

//     socket.on("disconnect", () => {
//         delete privateChatIds[socket.id];
//         console.log(privateChatIds);
//     });
// });
