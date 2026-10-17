import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  House,
  Globe,
  ExternalLink,
  UserRound,
  LogOut,
  KeyRound,
  Loader2,
  Clock,
  X,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  normalizeAddress,
  encodeToken,
  decodeToken,
  loadRecents,
  pushRecent,
  removeRecent,
  type RecentSite,
} from "@/lib/relay";

type Session = { token: string; origin: string; rest: string } | null;

function displayUrl(origin: string, rest: string): string {
  return origin + (rest === "/" ? "/" : rest);
}

export default function Browser() {
  const navigate = useNavigate();
  const me = trpc.auth.me.useQuery(undefined, { refetchInterval: 30_000 });

  // 未登录 → 跳回登录页
  useEffect(() => {
    if (!me.isLoading && !me.data) {
      navigate("/login", { replace: true });
    }
  }, [me.isLoading, me.data, navigate]);

  const [session, setSession] = useState<Session>(null);
  const [address, setAddress] = useState("");
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentSite[]>([]);
  const [pwdOpen, setPwdOpen] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sessionRef = useRef<Session>(null);
  const lastRecordedRef = useRef<string>("");
  sessionRef.current = session;

  useEffect(() => {
    setRecents(loadRecents());
  }, []);

  // 初始管理员强制改密
  useEffect(() => {
    if (me.data?.mustChangePassword) setPwdOpen(true);
  }, [me.data?.mustChangePassword]);

  const navigateTo = useCallback((raw: string) => {
    const origin = normalizeAddress(raw);
    if (!origin) {
      toast.error("地址格式不正确，示例：192.168.100.5:8080 或 http://10.0.0.2:9091");
      return;
    }
    const token = encodeToken(origin);
    setSession({ token, origin, rest: "/" });
    setAddress(displayUrl(origin, "/"));
    setFrameUrl(`/relay/${token}/`);
    lastRecordedRef.current = `${origin}|/`;
    setRecents(pushRecent(origin, "/"));
  }, []);

  // 轮询 iframe 内部地址，同步地址栏与最近访问
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      try {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        const path = win.location.pathname;
        const m = /^\/relay\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(path);
        if (!m) return;
        const token = m[1];
        const rest = m[2] ?? "/";
        const cur = sessionRef.current;
        if (!cur || cur.token !== token) {
          const origin = decodeToken(token);
          if (!origin) return;
          setSession({ token, origin, rest });
          setAddress(displayUrl(origin, rest));
          const key = `${origin}|${rest}`;
          if (lastRecordedRef.current !== key) {
            lastRecordedRef.current = key;
            setRecents(pushRecent(origin, rest));
          }
        } else if (cur.rest !== rest) {
          const next = { ...cur, rest };
          setSession(next);
          setAddress(displayUrl(next.origin, rest));
          const key = `${next.origin}|${rest}`;
          if (lastRecordedRef.current !== key) {
            lastRecordedRef.current = key;
            setRecents(pushRecent(next.origin, rest));
          }
        }
      } catch {
        /* 跨域或尚未加载时忽略 */
      }
    }, 700);
    return () => clearInterval(timer);
  }, [session !== null]);

  const iframeHistory = useCallback(
    (dir: "back" | "forward" | "reload") => {
      try {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        if (dir === "back") win.history.back();
        else if (dir === "forward") win.history.forward();
        else win.location.reload();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const goHome = useCallback(() => {
    setSession(null);
    setFrameUrl(null);
    setAddress("");
    lastRecordedRef.current = "";
  }, []);

  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      window.location.href = "/login";
    },
  });

  if (me.isLoading || !me.data) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      {/* 浏览器工具栏 */}
      <header className="z-10 border-b bg-zinc-900 text-zinc-100 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-2 sm:gap-2 sm:px-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => iframeHistory("back")}
              disabled={!session}
              aria-label="后退"
              className="h-11 w-11 text-zinc-300 hover:bg-zinc-800 hover:text-white sm:h-9 sm:w-9"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => iframeHistory("forward")}
              disabled={!session}
              aria-label="前进"
              className="h-11 w-11 text-zinc-300 hover:bg-zinc-800 hover:text-white sm:h-9 sm:w-9"
            >
              <ArrowRight className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => iframeHistory("reload")}
              disabled={!session}
              aria-label="刷新"
              className="h-11 w-11 text-zinc-300 hover:bg-zinc-800 hover:text-white sm:h-9 sm:w-9"
            >
              <RotateCw className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={goHome}
              aria-label="回到首页"
              className="h-11 w-11 text-zinc-300 hover:bg-zinc-800 hover:text-white sm:h-9 sm:w-9"
            >
              <House className="h-5 w-5" />
            </Button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              navigateTo(address);
            }}
            className="order-last flex w-full basis-full min-w-0 items-center gap-2 sm:order-none sm:basis-auto sm:flex-1"
          >
            <div className="relative min-w-0 flex-1">
              <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="输入内网地址，如 192.168.100.5:8080"
                className="h-11 border-zinc-700 bg-zinc-800 pl-9 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-zinc-500 sm:h-9"
                aria-label="目标地址"
              />
            </div>
            <Button
              type="submit"
              className="h-11 shrink-0 bg-blue-600 text-white hover:bg-blue-500 sm:h-9"
            >
              访问
            </Button>
          </form>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => frameUrl && window.open(frameUrl, "_blank")}
              disabled={!frameUrl}
              aria-label="在新标签页打开"
              className="h-11 w-11 text-zinc-300 hover:bg-zinc-800 hover:text-white sm:h-9 sm:w-9"
            >
              <ExternalLink className="h-5 w-5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="账户菜单"
                  className="h-11 w-11 text-zinc-300 hover:bg-zinc-800 hover:text-white sm:h-9 sm:w-9"
                >
                  <UserRound className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>
                  <div className="text-sm font-medium">{me.data.username}</div>
                  <div className="text-xs font-normal text-muted-foreground">
                    中继会话有效期 7 天
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setPwdOpen(true)}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  修改密码
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={logout.isPending}
                  onSelect={() => logout.mutate()}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* 内容区 */}
      <main className="min-h-0 flex-1">
        {session && frameUrl ? (
          <iframe
            ref={iframeRef}
            src={frameUrl}
            title="中继浏览"
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <HomePanel
            recents={recents}
            onGo={navigateTo}
            onRemove={(origin, path) => setRecents(removeRecent(origin, path))}
          />
        )}
      </main>

      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />
    </div>
  );
}

function HomePanel({
  recents,
  onGo,
  onRemove,
}: {
  recents: RecentSite[];
  onGo: (raw: string) => void;
  onRemove: (origin: string, path: string) => void;
}) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-8 px-4 py-10">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
          <Globe className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-semibold">输入内网地址开始浏览</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          支持局域网任意设备的 Web 服务，例如路由器、下载器、Docker 面板、监控页面等
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = new FormData(e.currentTarget).get("addr");
          onGo(String(input ?? ""));
        }}
        className="flex w-full max-w-md items-center gap-2"
      >
        <Input
          name="addr"
          placeholder="192.168.100.1"
          className="h-12 flex-1 text-base"
          autoFocus
        />
        <Button type="submit" className="h-12 px-5">
          访问
        </Button>
      </form>

      {recents.length > 0 && (
        <div className="w-full max-w-md">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Clock className="h-4 w-4" />
            最近访问
          </div>
          <div className="flex flex-wrap gap-2">
            {recents.map((r) => (
              <span
                key={`${r.origin}${r.path}`}
                className="group inline-flex items-center gap-1 rounded-full border bg-card py-1.5 pl-3 pr-1.5 text-sm shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => onGo(displayUrl(r.origin, r.path))}
                  className="max-w-56 truncate hover:underline"
                >
                  {displayUrl(r.origin, r.path)}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(r.origin, r.path)}
                  aria-label="删除该记录"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const utils = trpc.useUtils();

  const mutation = trpc.auth.changePassword.useMutation({
    onSuccess: async () => {
      toast.success("密码已更新，其它设备的会话已失效");
      setCurrent("");
      setNext("");
      setConfirm("");
      onOpenChange(false);
      await utils.auth.me.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (next !== confirm) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    if (!current) {
      toast.error("请输入当前密码");
      return;
    }
    mutation.mutate({ currentPassword: current, newPassword: next });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>修改密码</DialogTitle>
          <DialogDescription>
            新密码至少 8 位，需同时包含字母和数字。修改后其它设备的登录会话将失效。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="cur-pwd">当前密码</Label>
            <Input
              id="cur-pwd"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pwd">新密码</Label>
            <Input
              id="new-pwd"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cfm-pwd">确认新密码</Label>
            <Input
              id="cfm-pwd"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="h-11"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            确认修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
