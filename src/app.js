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
    const db = mongoClient.db();
} catch (err) {
    console.log(err.message);
}

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