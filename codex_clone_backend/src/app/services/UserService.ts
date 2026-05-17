import { User } from "../models/UserSchema";

interface CreateUserInput {
  id: string;
  name: string;
  image: string;
  access_token?: string;
  refresh_token?: string;
}

export class UserService {
  private static instance: UserService;

  // singelton design patterns
  public static getInstance(): UserService {
    if (!UserService.instance) {
      UserService.instance = new UserService();
    }

    return UserService.instance;
  }

  async createUser(props: CreateUserInput) {
    const { id: githubId, ...userData } = props;

    const existingUser = await User.findOne({ githubId });

    if (!existingUser) {
      const user = new User({
        ...userData,
        githubId,
      });

      const newUser = await user.save();

      return {
        authData: newUser.toObject(),
      };
    }

    const updatedUser = await User.findByIdAndUpdate(
      existingUser._id,
      {
        ...userData,
      },
      { new: true, runValidators: true },
    );

    return {
      authData: updatedUser?.toObject(),
    };
  }
}
