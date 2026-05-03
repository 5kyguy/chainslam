"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/matches", label: "Matches" },
  { href: "/strategies", label: "Strategies" },
  { href: "/keeperhub", label: "KeeperHub" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/season", label: "Season" },
  { href: "/creator/dashboard", label: "Creator" },
];

export function Navigation() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  return (
    <nav className="nav">
      <Link href="/" className="nav-logo">
        Agent<em>SLAM</em>
      </Link>
      <div className="nav-links">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href} className={cn("nl", active && "active")}>
              {item.label}
            </Link>
          );
        })}
      </div>
      <div className="nav-right">
        <span className="nav-bal mono">2,450 USDC</span>
        <div className="theme-toggle" role="group" aria-label="Theme switch">
          <button
            type="button"
            className={cn("theme-chip", theme === "cyber-blue" && "active")}
            onClick={() => setTheme("cyber-blue")}
          >
            Cyber
          </button>
          <button
            type="button"
            className={cn("theme-chip", theme === "arena-ember" && "active")}
            onClick={() => setTheme("arena-ember")}
          >
            Ember
          </button>
        </div>
        <Link href="/matches" className="nbtn fill">
          Enter Arena
        </Link>
      </div>
    </nav>
  );
}
