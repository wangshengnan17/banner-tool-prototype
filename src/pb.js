import PocketBase from "pocketbase";

const PB_URL = import.meta.env.VITE_PB_URL || "http://127.0.0.1:8090";

export const pb = new PocketBase(PB_URL);

pb.autoCancellation(false);

// Persist auth across page reloads
pb.authStore.onChange((_token, model) => {
  if (model) {
    localStorage.setItem("pb_auth", JSON.stringify({ token: pb.authStore.token, model }));
  } else {
    localStorage.removeItem("pb_auth");
  }
});

// Restore auth from localStorage
try {
  const saved = localStorage.getItem("pb_auth");
  if (saved) {
    const { token, model } = JSON.parse(saved);
    pb.authStore.save(token, model);
  }
} catch (_) {}

export default pb;
