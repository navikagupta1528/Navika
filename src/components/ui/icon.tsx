/**
 * The app's icon set, in one place.
 *
 * WHY A REGISTRY RATHER THAN IMPORTING `lucide-react` AT EACH CALL SITE
 * ---------------------------------------------------------------------
 * Navigation is built in a Server Component (the layouts) and rendered by a
 * Client Component (`PortalShell`), so the icon has to cross that boundary. A
 * component is not serialisable - `<PortalShell nav={[{ icon: Bus }]}>` cannot
 * work - but a *string* can. So the nav carries `icon: IconName` and the shell
 * resolves it here. The type is a union of the keys below, which means a typo is
 * a compile error rather than a silently missing glyph.
 *
 * WHY THIS FILE IS DELIBERATELY NOT `"use client"`
 * -----------------------------------------------
 * It was, on the reasonable-sounding theory that lucide's components sit behind
 * their own `"use client"` boundary and so the whole set should live on one side
 * of the same fence. That was measured, and it was expensive: a `"use client"`
 * module here is a client *entry point*, so every page whose graph touched an
 * icon - including the public landing and sign-in pages - pulled the entire set
 * into the browser and evaluated it. On the landing page that showed up as
 * ~390 ms of Total Blocking Time and a Lighthouse performance score of 86.
 *
 * As a plain module it is a Server Component for the server call sites: each
 * icon is rendered to static SVG in the HTML during the server pass, and only
 * the glyphs a Client Component actually renders are bundled for the browser.
 * The same landing page now scores 98 with ~40 ms of blocking time. If this file
 * is ever marked `"use client"` again, expect that ~10-point regression with it.
 *
 * Icons are decorative here. Every one is rendered `aria-hidden`, because the
 * meaning always lives in the text beside it - a `Badge` says "Simulated", the
 * icon only decorates the word. Where an icon is genuinely the only content of
 * a control, the call site supplies the accessible name itself.
 */
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Bus,
  CalendarDays,
  ChartColumn,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheckBig,
  ClipboardCheck,
  Clock,
  Download,
  Gauge,
  GraduationCap,
  IdCard,
  LayoutDashboard,
  LocateFixed,
  LogOut,
  Mail,
  Map,
  MapPin,
  Menu,
  Navigation,
  Radio,
  Route,
  Satellite,
  ShieldAlert,
  ShieldCheck,
  Signal,
  Smartphone,
  Sparkles,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  User,
  Users,
  Wifi,
  WifiOff,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

export const ICONS = {
  /* Navigation ------------------------------------------------------- */
  overview: LayoutDashboard,
  trips: CalendarDays,
  students: GraduationCap,
  stops: MapPin,
  routes: Route,
  fleet: Bus,
  drivers: IdCard,
  alerts: TriangleAlert,
  reports: ChartColumn,
  bell: Bell,
  install: Download,
  clipboard: ClipboardCheck,

  /* Chrome ----------------------------------------------------------- */
  menu: Menu,
  close: X,
  logout: LogOut,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  arrowUpRight: ArrowUpRight,

  /* Tracking and status ---------------------------------------------- */
  bus: Bus,
  radio: Radio,
  satellite: Satellite,
  locate: LocateFixed,
  navigate: Navigation,
  map: Map,
  pin: MapPin,
  activity: Activity,
  gauge: Gauge,
  signal: Signal,
  zap: Zap,
  clock: Clock,
  wifi: Wifi,
  wifiOff: WifiOff,
  check: CircleCheckBig,
  alert: CircleAlert,
  shield: ShieldCheck,
  shieldAlert: ShieldAlert,

  /* People and account ----------------------------------------------- */
  user: User,
  users: Users,
  graduation: GraduationCap,
  idCard: IdCard,
  phone: Smartphone,
  mail: Mail,

  /* Decorative ------------------------------------------------------- */
  sparkles: Sparkles,
  trendUp: TrendingUp,
  trendDown: TrendingDown,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  className,
  strokeWidth = 2,
}: {
  name: IconName;
  className?: string;
  /**
   * Lucide's line weight. The default 2 is right for text-sized icons; the
   * large decorative hero glyphs read better a touch lighter, so they pass 1.75.
   */
  strokeWidth?: number;
}) {
  const Glyph = ICONS[name] ?? Sparkles;
  return <Glyph aria-hidden className={className} strokeWidth={strokeWidth} />;
}
