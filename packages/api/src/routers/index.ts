import { publicProcedure, router } from "../index";
import { transportRouter } from "./transport";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => "OK"),
  transport: transportRouter,
});

export type AppRouter = typeof appRouter;