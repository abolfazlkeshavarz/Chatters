// Polyfills MUST load before anything else touches crypto / Buffer / base64.
import "./src/polyfills";

import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
