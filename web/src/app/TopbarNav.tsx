'use client';

import { type ComponentProps, type CSSProperties, useEffect, useState } from 'react';
import { Icon } from '@coinbase/cds-web/icons/Icon';
import { usePathname, useRouter } from 'next/navigation';

type CdsIconName = ComponentProps<typeof Icon>['name'];

type TopbarNavItem = {
  id: string;
  label: string;
  icon: CdsIconName;
  href?: string;
};

const navItems: TopbarNavItem[] = [
  { id: 'home', label: 'Home', icon: 'home', href: '/' },
  { id: 'launch', label: 'Launch', icon: 'tokenLaunchRocket', href: '/create' },
  { id: 'tokens', label: 'Tokens', icon: 'barChartSimple', href: '/tokens' },
  { id: 'portfolio', label: 'Portfolio', icon: 'baseWallet', href: '/portfolio' },
];

function getActiveIdFromPath(pathname: string) {
  if (pathname.startsWith('/create')) return 'launch';
  if (pathname.startsWith('/tokens')) return 'tokens';
  if (pathname.startsWith('/portfolio')) return 'portfolio';
  return 'home';
}

export function TopbarNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [activeId, setActiveId] = useState(() => getActiveIdFromPath(pathname));
  const activeIndex = Math.max(0, navItems.findIndex((item) => item.id === activeId));

  useEffect(() => {
    setActiveId(getActiveIdFromPath(pathname));
  }, [pathname]);

  useEffect(() => {
    navItems.forEach((item) => {
      if (item.href) router.prefetch(item.href);
    });
  }, [router]);

  return (
    <nav
      aria-label="Primary"
      className="dashboard-nav-pill"
      role="tablist"
      style={{ '--active-index': activeIndex } as CSSProperties & Record<'--active-index', number>}
    >
      <span className="dashboard-nav-indicator" aria-hidden="true" />
      {navItems.map((item) => {
        const isActive = item.id === activeId;

        return (
          <button
            aria-label={item.label}
            aria-selected={isActive}
            className={isActive ? 'is-active' : undefined}
            key={item.id}
            onClick={() => {
              setActiveId(item.id);
              const isCurrentRoute = item.href === '/'
                ? pathname === '/'
                : item.href ? pathname.startsWith(item.href) : false;

              if (item.href && !isCurrentRoute) {
                router.push(item.href);
              }
            }}
            role="tab"
            type="button"
          >
            <span className="nav-pill-icon-frame" aria-hidden="true">
              <Icon
                name={item.icon}
                size="s"
                active
                color="currentColor"
                classNames={{ root: 'nav-pill-icon', icon: 'nav-pill-icon-glyph' }}
              />
            </span>
            <span className="nav-pill-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
