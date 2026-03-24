import { NavLink } from "react-router-dom";

export function BrandNavigation() {
  return (
    <div className="flex items-baseline gap-3">
      <NavLink
        className={({ isActive }) =>
          `cursor-pointer text-left text-lg leading-none font-semibold tracking-[0.18em] transition-opacity ${
            isActive ? "text-foreground" : "text-foreground/80 hover:text-foreground"
          }`
        }
        data-testid="home-nav"
        end
        to="/"
      >
        underwritten
      </NavLink>
      <NavLink
        className={({ isActive }) =>
          `cursor-pointer text-sm leading-none tracking-[0.18em] lowercase transition-colors ${
            isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          }`
        }
        data-testid="about-nav"
        to="/about"
      >
        about
      </NavLink>
    </div>
  );
}
