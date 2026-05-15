import { Express } from "express";
import { expressServer } from "./express/expressServer";

export async function bootStrapApp(app: Express, PORT: number) {
  expressServer(app, PORT);
}
