import express from "express";
import cors from 'cors';
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import joi from 'joi';
import dayjs from "dayjs";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const date = dayjs().format("hh:mm:ss")

const PORT = 5000;
app.listen(5000);

const mongoClient = new MongoClient(process.env.DATABASE_URL);

try {
    await mongoClient.connect();
    console.log("Connected to Mongo");
} catch (err) {
    console.log("Erro ao conectar com o mongo", err.message);
}

const db = mongoClient.db();

app.post("/participants", async (req, res) => {
    const { name } = req.body;
    let checkUsername;

    const usernameSchema = joi.object({
        name: joi.string().required()
    });

    const usernameValidation = usernameSchema.validate({ name });

    if (usernameValidation.error) {
        return res.status(422).send(usernameValidation.error.details);
    }

    try {
        checkUsername = await db.collection("participants").findOne({ name });
    } catch {
        checkUsername = false;
        console.log("Erro na validação do nome do usuário")
    }

    if (checkUsername) {
        return res.status(409).send("Esse nome de usuário já está sendo utilizado.");
    }

    try {
        const participant = { name, lastStatus: Date.now() };

        await db.collection("participants").insertOne(participant);
        await db.collection("messages").insertOne({
            from: name,
            to: "Todos",
            text: "entra na sala...",
            type: "status",
            time: date,
        });
        res.status(201)
    } catch {
        console.log("Erro ao cadastrar usuário")
    }
})

app.get("/participants", async (req, res) => {
    try {
        let activeParticipants = await db.collection("participants").find().toArray()
        res.send(activeParticipants)
    } catch {
        res.status(500).send("Erro ao buscar participantes")
    }
})

app.post("/messages", async (req, res) => {
    const { to, text, type } = req.body;
    const from = req.headers.user;

    const time = dayjs(Date.now()).format("hh:mm:ss");

    const messageSchema = joi.object({
        to: joi.string().required(),
        text: joi.string().required(),
        type: joi.string().valid("private_message", "message").required()
    })

    const messageValidation = messageSchema.validate({ to, text, type });

    if (messageValidation.error) {
        return res.status(422).send(messageValidation.error.details);
    }

    try {
        await db.collection("participants").findOne({ name: from })
    } catch {
        res.status(422).send("Usuário não encontrado")
    }

    try {
        await db.collection("messages").insertOne({
            to,
            text,
            type,
            from,
            time,
        });
        res.status(201)
    } catch {
        res.status(500)
    }
});

app.get("/messages", async (req, res) => {
    const { user } = req.headers;

    try {
        const allMessages = await db.collection("messages").find().toArray();
    } catch {
        res.status(422).send("Erro ao buscar mensagens")
    }

    let limit;

    if (req.query.limit) {
        limit = parseInt(req.query.limit);

        if (limit < 1 || isNaN(limit)) {
            return res.status(422).send("Limite inválido")
        }
    }

    let userMessages = allMessages.filter((message) =>
        message.user === user ||
        message.from === user ||
        message.to === "Todos" ||
        message.to === user ||
        message.type === "status"
    );

    const limitedMessages = userMessages.splice(-limit).reverse()
    res.send(limitedMessages)
})

app.post("/status", async (req, res) => {
    const { user } = req.headers;
    const time = Date.now();

    try {
        await db.collection("participants").findOne({ name: user });
    } catch {
        return res.status(404).send("Usuário não encontrado");
    }

    const participantStatus = { name: user, lastStatus: time };

    try {
        await db.collection("participants").updateOne({ name: user }, { $set: participantStatus })
        res.status(200).send("Participante atualizado com sucesso")
    } catch {
        res.status(422).send("Usuário não encontrado")
    }
})

setInterval(
    async function removeUser() {
        const timeStatus = Date.now();
        const time = dayjs(Date.now()).format("hh:mm:ss");

        const inactiveUsers = await db.collection("participants").find({
            lastStatus: { $lt: timeStatus - 10000 }
        }).toArray();

        inactiveUsers.forEach(async (user) => {
            await db.collection("participants")
                .deleteOne({ name: user.name });
            await db.collection("messages")
                .insertOne({ from: user.name, to: "Todos", text: "sai da sala...", type: "status", time: time, });
        })
    }, 15000)
    