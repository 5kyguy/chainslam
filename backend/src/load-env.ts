import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/** `backend/.env` next to this file’s directory (`src` or `dist`) */
const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env");
dotenv.config({ path: envPath });
