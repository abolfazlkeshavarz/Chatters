import { useState } from "react";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Home from "./pages/Home";

export default function App() {
  const [loggedIn, setLoggedIn] = useState(
    !!localStorage.getItem("token")
  );
  const [page, setPage] = useState("login");

  if (loggedIn) {
    return <Home onLogout={() => setLoggedIn(false)} />;
  }

  if (page === "register") {
    return (
      <Register
        onRegister={() => setPage("login")}
      />
    );
  }

  return (
    <Login
      onLogin={() => setLoggedIn(true)}
      onRegister={() => setPage("register")}
    />
  );
}
