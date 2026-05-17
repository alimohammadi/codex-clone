import express, {
  Express,
  Response,
  Request,
  NextFunction,
  Router,
} from "express";
import { handleExpressError } from "../exceptions/handleExpressError";
import cors from "cors";
import passport from "passport";
import session from "express-session";
import { Strategy as GithubStrategy } from "passport-github2";
import MongoStore from "connect-mongo";
import { UserService } from "../../services/UserService";

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

  const sess = {
    store: MongoStore.create({
      mongoUrl: process.env.DB_URL as string,
      collectionName: "sessions",
      ttl: 14 * 24 * 60 * 60, // 14 days
    }),
    secret: process.env.COOKIE_KEY as string,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 14 * 24 * 60 * 60 * 1000,
    }, // 14 days
  };

  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  app.use(session(sess));
  app.use(passport.initialize());
  app.use(passport.session());

  // ------ GITHUB STRATEGY -----------
  passport.use(
    new GithubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID as string,
        clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
        callbackURL: process.env.CALLBACK_URL as string,
      },
      async (
        accessToken: string,
        refreshToken: string,
        profile: any,
        done: any,
      ) => {
        console.log("Create user ...", profile);
        try {
          const id = profile?.id;
          const name = profile?.displayName;
          const image = profile?.photos?.[0]?.value;

          const userService = UserService.getInstance();

          await userService.createUser({
            id,
            name,
            image,
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          return done(null, { id, name, image });
        } catch (error) {
          return done(error, {});
        }
      },
    ),
  );

  passport.serializeUser((user: any, done) => {
    done(null, user);
  });

  passport.deserializeUser(async (obj: any, done) => {
    try {
      done(null, obj);
    } catch (error) {
      done(error);
    }
  });

  app.get(
    "/auth/github",
    passport.authenticate("github", {
      scope: ["user:email"],
    }),
  );

  app.get(
    "/auth/github/callback",
    passport.authenticate("github", {
      failureRedirect: "/auth/login",
      successRedirect: process.env.FRONT_APP_URL,
    }),
  );

  app.get("/auth/logout", (req: Request, res: Response, next: NextFunction) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ message: "Logged out successfully" });
      });
    });
  });

  app.get("/auth/me", (req: Request, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not logged in" });
    res.json(req.user);
  });

  app.listen(PORT, () => {
    console.log(`Express is running at http://localhost:${PORT}`);
  });
}
