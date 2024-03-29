import express from "express";
import cors from 'cors';
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import joi from 'joi';
import dayjs from "dayjs";
import { stripHtml } from "string-strip-html";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const date = dayjs().format("hh:mm:ss")

const PORT = 5000;

const mongoClient = new MongoClient(process.env.DATABASE_URL);

try {
    await mongoClient.connect();
} catch (err) {
    res.sendStatus(500);
}

const db = mongoClient.db();

app.post("/participants", async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== "string") return res.sendStatus(422)

    const sanitized_name = stripHtml(name).result;

    const usernameSchema = joi.object({
        name: joi.string().min(1).trim().required()
    });

    const validation = usernameSchema.validate({ name: sanitized_name }, { abortEarly: false });

    if (validation.error) {
        const errors = validation.error.details.map(detail => detail.message);
        return res.status(422).send({ errors });
    }

    try {
        const isUserActive = await db.collection("participants").findOne({ name: sanitized_name });
        if (isUserActive) {
            return res.sendStatus(409);
        }

        const participants = {
            name: sanitized_name,
            lastStatus: Date.now()
        };
        await db.collection("participants").insertOne(participants);

        const message = {
            from: sanitized_name,
            to: "Todos",
            text: "entra na sala...",
            type: "status",
            time: date,
        };
        await db.collection("messages").insertOne(message);

        res.sendStatus(201);
    } catch {
        res.sendStatus(500);
    }
})

app.get("/participants", async (req, res) => {
    try {
        let activeParticipants = await db.collection("participants").find().toArray();
        res.status(200).send(activeParticipants);
    } catch {
        res.sendStatus(500);
    }
})

app.post("/messages", async (req, res) => {
    const { to, text, type } = req.body;
    const from = req.headers.user;
    if (!to || !text || !type || !from) return res.sendStatus(422)

    const sanitized_to = stripHtml(to).result;
    const sanitized_text = stripHtml(text).result;

    const time = dayjs(Date.now()).format("hh:mm:ss");

    const messageSchema = joi.object({
        to: joi.string().min(1).trim().required(),
        text: joi.string().min(1).trim().required(),
        type: joi.string().valid("private_message", "message").required()
    })

    const validation = messageSchema.validate({ to: sanitized_to, text: sanitized_text, type });

    if (validation.error) {
        const errors = validation.error.details.map(detail => detail.message);
        return res.status(422).send({ errors });
    }

    try {
        const isUser = await db.collection("participants").findOne({ name: from })
        if (!isUser) {
            return res.sendStatus(422);
        }
    } catch {
        return res.sendStatus(500);
    }

    try {
        await db.collection("messages").insertOne({
            to: sanitized_to,
            text: sanitized_text,
            type,
            from,
            time,
        });
        res.sendStatus(201);
    } catch {
        res.sendStatus(500);
    }
});

app.get("/messages", async (req, res) => {
    const { user } = req.headers;
    let allMessages;
    let limit;

    try {
        allMessages = await db.collection("messages").find().toArray();
    } catch {
        res.status(422).send("Erro ao buscar mensagens")
    }

    if (req.query.limit) {
        limit = parseInt(req.query.limit);

        if (limit < 1 || isNaN(limit)) {
            return res.status(422).send("Limite inválido")
        }
    } else {
        limit = 100;
    }

    const filteredMessages = allMessages.filter(message => {
        return message.type === "message" || message.from === user || message.to === user || message.to === "Todos";
    }).slice(-limit);

    res.status(200).send(filteredMessages);
})

app.post("/status", async (req, res) => {
    const { user } = req.headers;

    try {
        const existingUser = await db.collection("participants").findOne({ name: user });

        if (!existingUser) {
            return res.sendStatus(404);
        }

        const updatedParticipant = await db.collection("participants").findOneAndUpdate(
            { name: user },
            { $set: { lastStatus: Date.now() } },
            { returnDocument: "after" }
        );

        if (!updatedParticipant.value) {
            res.sendStatus(400);
        } else {
            res.sendStatus(200);
        }
    } catch {
        res.sendStatus(500);
    }
});

app.put("/messages/:id", async (req, res) => {
    const { id } = req.params;
    const { to, text, type } = req.body;
    const from = req.headers.user;
    if (!id || !to || !text || !type || !from) return res.sendStatus(422)


    const sanitized_to = stripHtml(to).result;
    const sanitized_text = stripHtml(text).result;

    const messageSchema = joi.object({
        to: joi.string().min(1).trim().required(),
        text: joi.string().min(1).trim().required(),
        type: joi.string().valid("message", "private_message").required()
    });

    const validation = messageSchema.validate({ to: sanitized_to, text: sanitized_text, type });

    if (validation.error) {
        const errors = validation.error.details.map(detail => detail.message);
        return res.status(422).send({ errors });
    }

    try {
        const isUser = await db.collection("participants").findOne({ name: from })
        if (!isUser) {
            return res.sendStatus(422);
        }
    } catch {
        return res.sendStatus(500);
    }

    try {
        const message = await db.collection("messages").findOne({ _id: ObjectId(id) });
        if (!message) {
            return res.sendStatus(404);
        }
        if (message.from !== from) {
            return res.sendStatus(401);
        }

        await db.collection("messages").updateOne(
            { _id: ObjectId(id) },
            { $set: { to: sanitized_to, text: sanitized_text, type } }
        );
        res.sendStatus(200);
    } catch {
        res.sendStatus(500);
    }
});

app.delete("/messages/:id", async (req, res) => {
    const { id } = req.params;
    const name = req.headers.user;

    try {
        const message = await db.collection("messages").findOne({ _id: ObjectId(id) });

        if (!message) return res.sendStatus(404);

        if (message.from !== name) return res.sendStatus(401);

        await db.collection("messages").deleteOne({ _id: ObjectId(id) });

        res.sendStatus(200);
    } catch {
        res.sendStatus(500);
    }
});

setInterval(
    async () => {
        const now = Date.now();
        const time = dayjs(Date.now()).format("hh:mm:ss");

        const inactiveUsers = await db.collection("participants").find({
            lastStatus: { $lt: now - 10000 }
        }).toArray();

        inactiveUsers.forEach(async (user) => {
            await db.collection("participants").deleteOne({ name: user.name });
            await db.collection("messages").insertOne({
                from: user.name,
                to: "Todos",
                text: "sai da sala...",
                type: "status",
                time: time
            });
        })
    }, 15000)

app.listen(PORT);
