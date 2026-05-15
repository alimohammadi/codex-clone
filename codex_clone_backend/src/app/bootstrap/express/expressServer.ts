import express, {
  Express,
  Response,
  Request,
  NextFunction,
  Router,
} from "express";
import { handleExpressError } from "../exceptions/handleExpressError";
import cors from "cors";

export function expressServer(app: Express, PORT: number) {
  const router = Router();

  app.use(
    cors({
      origin: "*",
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(handleExpressError);

  app.get("/", async (req: Request, res: Response) => {
    res.json({ message: "Server is up and running" });
  });

  app.listen(PORT, () => {
    console.log(`Express is running at http://localhost:${PORT}`);
  });
}
