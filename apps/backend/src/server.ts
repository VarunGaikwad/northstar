import { env } from "./config/env";
import app from "./index";

app.listen(env.PORT, () => {
  console.log(`Northstar backend listening on port ${env.PORT}`);
});
