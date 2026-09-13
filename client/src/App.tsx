import { useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { RecipeListPage } from "./pages/RecipeListPage";
import { RecipeDetailPage } from "./pages/RecipeDetailPage";
import { RecipeFormPage } from "./pages/RecipeFormPage";
import { HouseholdPage } from "./pages/HouseholdPage";
import { LoginPage } from "./pages/LoginPage";

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-loading">
        <span className="wordmark">
          <span className="wordmark-dot" aria-hidden="true" />
          foodit
        </span>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/" className="wordmark">
            <span className="wordmark-dot" aria-hidden="true" />
            foodit
          </Link>
          <UserMenu />
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<RecipeListPage />} />
          <Route path="/recipes/new" element={<RecipeFormPage />} />
          <Route path="/recipes/:id" element={<RecipeDetailPage />} />
          <Route path="/recipes/:id/edit" element={<RecipeFormPage />} />
          <Route path="/household" element={<HouseholdPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

function UserMenu() {
  const { user, household, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const initial = (user?.name ?? user?.email ?? "?").charAt(0).toUpperCase();

  return (
    <div className="user-menu">
      <button
        className="avatar-button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
      >
        {initial}
      </button>

      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu-pop" role="menu">
            <div className="menu-head">
              <div className="menu-email">{user?.email}</div>
              {household && <div className="menu-household">{household.name}</div>}
            </div>
            <Link to="/household" className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
              Household &amp; members
            </Link>
            <button
              className="menu-item menu-item--danger"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                logout();
              }}
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function NotFound() {
  return (
    <div className="container">
      <div className="empty-state">
        <p className="empty-title">Page not found</p>
        <Link to="/" className="btn btn-primary">
          Back to recipes
        </Link>
      </div>
    </div>
  );
}

export default App;
