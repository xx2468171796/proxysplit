export namespace accel {
	
	export class Stats {
	    requests: number;
	    relayed: number;
	    direct: number;
	    resumed: number;
	    errors: number;
	    held: number;
	    reqBytes: number;
	    frameBytes: number;
	
	    static createFrom(source: any = {}) {
	        return new Stats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.requests = source["requests"];
	        this.relayed = source["relayed"];
	        this.direct = source["direct"];
	        this.resumed = source["resumed"];
	        this.errors = source["errors"];
	        this.held = source["held"];
	        this.reqBytes = source["reqBytes"];
	        this.frameBytes = source["frameBytes"];
	    }
	}
	export class State {
	    mode: string;
	    manual: string;
	    auto: boolean;
	    enabled: boolean;
	    reason: string;
	    relay: string;
	    rttMs: number;
	    gatewayInUse: boolean;
	    handshake: string;
	    addr: string;
	    // Go type: time
	    since: any;
	    stats: Stats;
	
	    static createFrom(source: any = {}) {
	        return new State(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.manual = source["manual"];
	        this.auto = source["auto"];
	        this.enabled = source["enabled"];
	        this.reason = source["reason"];
	        this.relay = source["relay"];
	        this.rttMs = source["rttMs"];
	        this.gatewayInUse = source["gatewayInUse"];
	        this.handshake = source["handshake"];
	        this.addr = source["addr"];
	        this.since = this.convertValues(source["since"], null);
	        this.stats = this.convertValues(source["stats"], Stats);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace appid {
	
	export class Access {
	    time: string;
	    host: string;
	    network: string;
	    outbound: string;
	    rule: string;
	    status: string;
	    reason?: string;
	    process: string;
	    path?: string;
	    seconds: number;
	    upload: number;
	    download: number;
	
	    static createFrom(source: any = {}) {
	        return new Access(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = source["time"];
	        this.host = source["host"];
	        this.network = source["network"];
	        this.outbound = source["outbound"];
	        this.rule = source["rule"];
	        this.status = source["status"];
	        this.reason = source["reason"];
	        this.process = source["process"];
	        this.path = source["path"];
	        this.seconds = source["seconds"];
	        this.upload = source["upload"];
	        this.download = source["download"];
	    }
	}
	export class App {
	    id: string;
	    name: string;
	    category: string;
	    processes: string[];
	    note?: string;
	    builtin: boolean;
	    dirs?: string[];
	
	    static createFrom(source: any = {}) {
	        return new App(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.category = source["category"];
	        this.processes = source["processes"];
	        this.note = source["note"];
	        this.builtin = source["builtin"];
	        this.dirs = source["dirs"];
	    }
	}
	export class HostStat {
	    host: string;
	    conns: number;
	    live: number;
	    ok: number;
	    done: number;
	    failed: number;
	    blocked: number;
	    upload: number;
	    download: number;
	    exit: string;
	    network: string;
	    lastSeen: string;
	    lastError: string;
	    seconds: number;
	
	    static createFrom(source: any = {}) {
	        return new HostStat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.conns = source["conns"];
	        this.live = source["live"];
	        this.ok = source["ok"];
	        this.done = source["done"];
	        this.failed = source["failed"];
	        this.blocked = source["blocked"];
	        this.upload = source["upload"];
	        this.download = source["download"];
	        this.exit = source["exit"];
	        this.network = source["network"];
	        this.lastSeen = source["lastSeen"];
	        this.lastError = source["lastError"];
	        this.seconds = source["seconds"];
	    }
	}
	export class ProcStat {
	    process: string;
	    path?: string;
	    total: number;
	    failed: number;
	    download: number;
	    lastSeen?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProcStat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.process = source["process"];
	        this.path = source["path"];
	        this.total = source["total"];
	        this.failed = source["failed"];
	        this.download = source["download"];
	        this.lastSeen = source["lastSeen"];
	    }
	}
	export class Stat {
	    process: string;
	    health: string;
	    live: number;
	    total: number;
	    ok: number;
	    done: number;
	    failed: number;
	    upload: number;
	    download: number;
	    lastSeen?: string;
	    lastOk?: string;
	    lastFail?: string;
	    lastHost?: string;
	    lastExit?: string;
	
	    static createFrom(source: any = {}) {
	        return new Stat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.process = source["process"];
	        this.health = source["health"];
	        this.live = source["live"];
	        this.total = source["total"];
	        this.ok = source["ok"];
	        this.done = source["done"];
	        this.failed = source["failed"];
	        this.upload = source["upload"];
	        this.download = source["download"];
	        this.lastSeen = source["lastSeen"];
	        this.lastOk = source["lastOk"];
	        this.lastFail = source["lastFail"];
	        this.lastHost = source["lastHost"];
	        this.lastExit = source["lastExit"];
	    }
	}

}

export namespace core {
	
	export class RouteRule {
	    type: string;
	    value: string;
	    action: string;
	
	    static createFrom(source: any = {}) {
	        return new RouteRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.value = source["value"];
	        this.action = source["action"];
	    }
	}

}

export namespace license {
	
	export class Announcement {
	    id: string;
	    type: string;
	    title: string;
	    summary: string;
	    content: string;
	    version: string;
	    pinned: boolean;
	    publishedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Announcement(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.type = source["type"];
	        this.title = source["title"];
	        this.summary = source["summary"];
	        this.content = source["content"];
	        this.version = source["version"];
	        this.pinned = source["pinned"];
	        this.publishedAt = source["publishedAt"];
	    }
	}
	export class Device {
	    id: string;
	    name: string;
	    platform: string;
	    appVersion: string;
	    firstSeenAt: string;
	    lastSeenAt: string;
	    current: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Device(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.platform = source["platform"];
	        this.appVersion = source["appVersion"];
	        this.firstSeenAt = source["firstSeenAt"];
	        this.lastSeenAt = source["lastSeenAt"];
	        this.current = source["current"];
	    }
	}
	export class Order {
	    orderNo: string;
	    planName: string;
	    amountCents: number;
	    currency: string;
	    status: string;
	    payUrl: string;
	    checkoutUrl: string;
	    paidAt: string;
	    expiresAt: string;
	    createdAt: string;
	    splitIndex: number;
	    splitTotal: number;
	
	    static createFrom(source: any = {}) {
	        return new Order(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.orderNo = source["orderNo"];
	        this.planName = source["planName"];
	        this.amountCents = source["amountCents"];
	        this.currency = source["currency"];
	        this.status = source["status"];
	        this.payUrl = source["payUrl"];
	        this.checkoutUrl = source["checkoutUrl"];
	        this.paidAt = source["paidAt"];
	        this.expiresAt = source["expiresAt"];
	        this.createdAt = source["createdAt"];
	        this.splitIndex = source["splitIndex"];
	        this.splitTotal = source["splitTotal"];
	    }
	}
	export class Plan {
	    id: string;
	    code: string;
	    name: string;
	    description: string;
	    tier: string;
	    billingCycle: string;
	    durationDays?: number;
	    lifetime: boolean;
	    priceCents: number;
	    originalPriceCents?: number;
	    currency: string;
	    maxDevices: number;
	    features: string[];
	    badge: string;
	    saleEndsAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Plan(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.code = source["code"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.tier = source["tier"];
	        this.billingCycle = source["billingCycle"];
	        this.durationDays = source["durationDays"];
	        this.lifetime = source["lifetime"];
	        this.priceCents = source["priceCents"];
	        this.originalPriceCents = source["originalPriceCents"];
	        this.currency = source["currency"];
	        this.maxDevices = source["maxDevices"];
	        this.features = source["features"];
	        this.badge = source["badge"];
	        this.saleEndsAt = source["saleEndsAt"];
	    }
	}
	export class Status {
	    enabled: boolean;
	    signedIn: boolean;
	    authenticated: boolean;
	    username: string;
	    plan: string;
	    planCode: string;
	    tier: string;
	    maxDevices: number;
	    features: string[];
	    expiresAt: string;
	    offlineUntil: string;
	    deviceLimitReached: boolean;
	    channel: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.signedIn = source["signedIn"];
	        this.authenticated = source["authenticated"];
	        this.username = source["username"];
	        this.plan = source["plan"];
	        this.planCode = source["planCode"];
	        this.tier = source["tier"];
	        this.maxDevices = source["maxDevices"];
	        this.features = source["features"];
	        this.expiresAt = source["expiresAt"];
	        this.offlineUntil = source["offlineUntil"];
	        this.deviceLimitReached = source["deviceLimitReached"];
	        this.channel = source["channel"];
	        this.error = source["error"];
	    }
	}

}

export namespace main {
	
	export class AIControlInfo {
	    url: string;
	    token: string;
	    prompt: string;
	    mcpConfig: string;
	    running: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AIControlInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.url = source["url"];
	        this.token = source["token"];
	        this.prompt = source["prompt"];
	        this.mcpConfig = source["mcpConfig"];
	        this.running = source["running"];
	    }
	}
	export class AIHijackState {
	    on: boolean;
	    locked: boolean;
	    visible: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AIHijackState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.on = source["on"];
	        this.locked = source["locked"];
	        this.visible = source["visible"];
	    }
	}
	export class AddResult {
	    added: number;
	    skipped: number;
	
	    static createFrom(source: any = {}) {
	        return new AddResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.added = source["added"];
	        this.skipped = source["skipped"];
	    }
	}
	export class AnnouncementsResult {
	    items: license.Announcement[];
	    err?: string;
	
	    static createFrom(source: any = {}) {
	        return new AnnouncementsResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], license.Announcement);
	        this.err = source["err"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BootstrapState {
	    ready: boolean;
	    error?: string;
	    nodes: nodes.Node[];
	    rules: service.AppRule[];
	    lines: service.Line[];
	    subs: service.Sub[];
	    settings: service.Settings;
	    defaultLine: string;
	    ruleMode: string;
	    status: service.Status;
	    license: license.Status;
	
	    static createFrom(source: any = {}) {
	        return new BootstrapState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ready = source["ready"];
	        this.error = source["error"];
	        this.nodes = this.convertValues(source["nodes"], nodes.Node);
	        this.rules = this.convertValues(source["rules"], service.AppRule);
	        this.lines = this.convertValues(source["lines"], service.Line);
	        this.subs = this.convertValues(source["subs"], service.Sub);
	        this.settings = this.convertValues(source["settings"], service.Settings);
	        this.defaultLine = source["defaultLine"];
	        this.ruleMode = source["ruleMode"];
	        this.status = this.convertValues(source["status"], service.Status);
	        this.license = this.convertValues(source["license"], license.Status);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DevicesResult {
	    items: license.Device[];
	    err?: string;
	
	    static createFrom(source: any = {}) {
	        return new DevicesResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], license.Device);
	        this.err = source["err"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class OrderResult {
	    split: boolean;
	    groupNo?: string;
	    orders: license.Order[];
	    order: license.Order;
	    err?: string;
	
	    static createFrom(source: any = {}) {
	        return new OrderResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.split = source["split"];
	        this.groupNo = source["groupNo"];
	        this.orders = this.convertValues(source["orders"], license.Order);
	        this.order = this.convertValues(source["order"], license.Order);
	        this.err = source["err"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class OrdersResult {
	    items: license.Order[];
	    err?: string;
	
	    static createFrom(source: any = {}) {
	        return new OrdersResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], license.Order);
	        this.err = source["err"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PlansResult {
	    items: license.Plan[];
	    err?: string;
	
	    static createFrom(source: any = {}) {
	        return new PlansResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], license.Plan);
	        this.err = source["err"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PowerVPNStatus {
	    loggedIn: boolean;
	    username: string;
	
	    static createFrom(source: any = {}) {
	        return new PowerVPNStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.loggedIn = source["loggedIn"];
	        this.username = source["username"];
	    }
	}
	export class QRResult {
	    data: string;
	    err: string;
	
	    static createFrom(source: any = {}) {
	        return new QRResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = source["data"];
	        this.err = source["err"];
	    }
	}
	export class ReleaseNote {
	    version: string;
	    items: string[];
	
	    static createFrom(source: any = {}) {
	        return new ReleaseNote(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.items = source["items"];
	    }
	}
	export class SpeedResult {
	    mbps: number;
	    err: string;
	
	    static createFrom(source: any = {}) {
	        return new SpeedResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mbps = source["mbps"];
	        this.err = source["err"];
	    }
	}

}

export namespace nodes {
	
	export class EgressAllow {
	    domains?: string[];
	    domainSuffixes?: string[];
	    domainKeywords?: string[];
	    ipCidrs?: string[];
	
	    static createFrom(source: any = {}) {
	        return new EgressAllow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.domains = source["domains"];
	        this.domainSuffixes = source["domainSuffixes"];
	        this.domainKeywords = source["domainKeywords"];
	        this.ipCidrs = source["ipCidrs"];
	    }
	}
	export class Egress {
	    mode: string;
	    revision?: number;
	    allow?: EgressAllow;
	    deny?: EgressAllow;
	    denyExcept?: string[];
	    summary?: string[];
	
	    static createFrom(source: any = {}) {
	        return new Egress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.revision = source["revision"];
	        this.allow = this.convertValues(source["allow"], EgressAllow);
	        this.deny = this.convertValues(source["deny"], EgressAllow);
	        this.denyExcept = source["denyExcept"];
	        this.summary = source["summary"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Node {
	    id: string;
	    name: string;
	    type: string;
	    server: string;
	    port: number;
	    uuid?: string;
	    password?: string;
	    username?: string;
	    method?: string;
	    alterId?: number;
	    cipher?: string;
	    cc?: string;
	    security?: string;
	    sni?: string;
	    alpn?: string[];
	    fingerprint?: string;
	    flow?: string;
	    publicKey?: string;
	    shortId?: string;
	    insecure?: boolean;
	    network?: string;
	    path?: string;
	    host?: string;
	    multiplex?: Record<string, any>;
	    plugin?: string;
	    pluginOpts?: string;
	    official?: boolean;
	    accountId?: string;
	    officialKey?: string;
	    outbounds?: number[][];
	    entryTag?: string;
	    egress?: Egress;
	    latency: number;
	    tcpLatency: number;
	    speed: number;
	    subId?: string;
	    raw?: string;
	
	    static createFrom(source: any = {}) {
	        return new Node(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.type = source["type"];
	        this.server = source["server"];
	        this.port = source["port"];
	        this.uuid = source["uuid"];
	        this.password = source["password"];
	        this.username = source["username"];
	        this.method = source["method"];
	        this.alterId = source["alterId"];
	        this.cipher = source["cipher"];
	        this.cc = source["cc"];
	        this.security = source["security"];
	        this.sni = source["sni"];
	        this.alpn = source["alpn"];
	        this.fingerprint = source["fingerprint"];
	        this.flow = source["flow"];
	        this.publicKey = source["publicKey"];
	        this.shortId = source["shortId"];
	        this.insecure = source["insecure"];
	        this.network = source["network"];
	        this.path = source["path"];
	        this.host = source["host"];
	        this.multiplex = source["multiplex"];
	        this.plugin = source["plugin"];
	        this.pluginOpts = source["pluginOpts"];
	        this.official = source["official"];
	        this.accountId = source["accountId"];
	        this.officialKey = source["officialKey"];
	        this.outbounds = source["outbounds"];
	        this.entryTag = source["entryTag"];
	        this.egress = this.convertValues(source["egress"], Egress);
	        this.latency = source["latency"];
	        this.tcpLatency = source["tcpLatency"];
	        this.speed = source["speed"];
	        this.subId = source["subId"];
	        this.raw = source["raw"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace proc {
	
	export class ProcInfo {
	    name: string;
	    desc: string;
	    path: string;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new ProcInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.desc = source["desc"];
	        this.path = source["path"];
	        this.count = source["count"];
	    }
	}

}

export namespace service {
	
	export class AIEnvItem {
	    id: string;
	    name: string;
	    status: string;
	    detail: string;
	    fix?: string;
	
	    static createFrom(source: any = {}) {
	        return new AIEnvItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.status = source["status"];
	        this.detail = source["detail"];
	        this.fix = source["fix"];
	    }
	}
	export class AIEnvReport {
	    items: AIEnvItem[];
	    exitIp?: string;
	    exitLoc?: string;
	    exitKind?: string;
	    exitAsn?: string;
	    exitOurs: boolean;
	    checkedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new AIEnvReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], AIEnvItem);
	        this.exitIp = source["exitIp"];
	        this.exitLoc = source["exitLoc"];
	        this.exitKind = source["exitKind"];
	        this.exitAsn = source["exitAsn"];
	        this.exitOurs = source["exitOurs"];
	        this.checkedAt = source["checkedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AppDetail {
	    stat: appid.Stat;
	    processes: appid.ProcStat[];
	    hosts: appid.HostStat[];
	    access: appid.Access[];
	    logs: string[];
	
	    static createFrom(source: any = {}) {
	        return new AppDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.stat = this.convertValues(source["stat"], appid.Stat);
	        this.processes = this.convertValues(source["processes"], appid.ProcStat);
	        this.hosts = this.convertValues(source["hosts"], appid.HostStat);
	        this.access = this.convertValues(source["access"], appid.Access);
	        this.logs = source["logs"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AppRule {
	    match: string;
	    path: string;
	    line: string;
	    node?: string;
	    enabled: boolean;
	    domains?: string[];
	    ips?: string[];
	    ports?: string[];
	    action?: string;
	    follow?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AppRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.match = source["match"];
	        this.path = source["path"];
	        this.line = source["line"];
	        this.node = source["node"];
	        this.enabled = source["enabled"];
	        this.domains = source["domains"];
	        this.ips = source["ips"];
	        this.ports = source["ports"];
	        this.action = source["action"];
	        this.follow = source["follow"];
	    }
	}
	export class ConnInfo {
	    process: string;
	    path?: string;
	    host: string;
	    dest: string;
	    network: string;
	    rule: string;
	    outTag: string;
	    outbound: string;
	    upload: number;
	    download: number;
	    id?: string;
	    source?: string;
	    srcPort?: string;
	    start?: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.process = source["process"];
	        this.path = source["path"];
	        this.host = source["host"];
	        this.dest = source["dest"];
	        this.network = source["network"];
	        this.rule = source["rule"];
	        this.outTag = source["outTag"];
	        this.outbound = source["outbound"];
	        this.upload = source["upload"];
	        this.download = source["download"];
	        this.id = source["id"];
	        this.source = source["source"];
	        this.srcPort = source["srcPort"];
	        this.start = source["start"];
	    }
	}
	export class LineHealth {
	    id: string;
	    name: string;
	    node: string;
	    latency: number;
	    ok: boolean;
	
	    static createFrom(source: any = {}) {
	        return new LineHealth(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.node = source["node"];
	        this.latency = source["latency"];
	        this.ok = source["ok"];
	    }
	}
	export class Health {
	    running: boolean;
	    capturing: boolean;
	    capturedPkts: number;
	    warning: string;
	    lines: LineHealth[];
	
	    static createFrom(source: any = {}) {
	        return new Health(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.running = source["running"];
	        this.capturing = source["capturing"];
	        this.capturedPkts = source["capturedPkts"];
	        this.warning = source["warning"];
	        this.lines = this.convertValues(source["lines"], LineHealth);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Routing {
	    enabled: boolean;
	    mode: string;
	    rules: core.RouteRule[];
	
	    static createFrom(source: any = {}) {
	        return new Routing(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.mode = source["mode"];
	        this.rules = this.convertValues(source["rules"], core.RouteRule);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Line {
	    id: string;
	    name: string;
	    node: string;
	    routing: Routing;
	    builtin: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Line(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.node = source["node"];
	        this.routing = this.convertValues(source["routing"], Routing);
	        this.builtin = source["builtin"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class PortAccess {
	    time: string;
	    client: string;
	    host: string;
	    network: string;
	    outbound: string;
	    rule: string;
	
	    static createFrom(source: any = {}) {
	        return new PortAccess(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = source["time"];
	        this.client = source["client"];
	        this.host = source["host"];
	        this.network = source["network"];
	        this.outbound = source["outbound"];
	        this.rule = source["rule"];
	    }
	}
	export class PortClient {
	    ip: string;
	    conns: number;
	    total: number;
	    upload: number;
	    download: number;
	    firstSeen: string;
	    lastSeen: string;
	
	    static createFrom(source: any = {}) {
	        return new PortClient(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ip = source["ip"];
	        this.conns = source["conns"];
	        this.total = source["total"];
	        this.upload = source["upload"];
	        this.download = source["download"];
	        this.firstSeen = source["firstSeen"];
	        this.lastSeen = source["lastSeen"];
	    }
	}
	export class PortDetail {
	    conns: ConnInfo[];
	    access: PortAccess[];
	    logs: string[];
	
	    static createFrom(source: any = {}) {
	        return new PortDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.conns = this.convertValues(source["conns"], ConnInfo);
	        this.access = this.convertValues(source["access"], PortAccess);
	        this.logs = source["logs"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProxyPort {
	    id: string;
	    name: string;
	    enabled: boolean;
	    port: number;
	    protocol: string;
	    lan: boolean;
	    user: string;
	    pass: string;
	    mode: string;
	    node: string;
	
	    static createFrom(source: any = {}) {
	        return new ProxyPort(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.enabled = source["enabled"];
	        this.port = source["port"];
	        this.protocol = source["protocol"];
	        this.lan = source["lan"];
	        this.user = source["user"];
	        this.pass = source["pass"];
	        this.mode = source["mode"];
	        this.node = source["node"];
	    }
	}
	export class ProxyPortStatus {
	    id: string;
	    name: string;
	    enabled: boolean;
	    port: number;
	    protocol: string;
	    lan: boolean;
	    user: string;
	    pass: string;
	    mode: string;
	    node: string;
	    running: boolean;
	    error?: string;
	    nodeName: string;
	    conns: number;
	    upload: number;
	    download: number;
	    clients: PortClient[];
	
	    static createFrom(source: any = {}) {
	        return new ProxyPortStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.enabled = source["enabled"];
	        this.port = source["port"];
	        this.protocol = source["protocol"];
	        this.lan = source["lan"];
	        this.user = source["user"];
	        this.pass = source["pass"];
	        this.mode = source["mode"];
	        this.node = source["node"];
	        this.running = source["running"];
	        this.error = source["error"];
	        this.nodeName = source["nodeName"];
	        this.conns = source["conns"];
	        this.upload = source["upload"];
	        this.download = source["download"];
	        this.clients = this.convertValues(source["clients"], PortClient);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RouteHop {
	    host: string;
	    dest?: string;
	    rule?: string;
	    outTag: string;
	    outbound?: string;
	
	    static createFrom(source: any = {}) {
	        return new RouteHop(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.dest = source["dest"];
	        this.rule = source["rule"];
	        this.outTag = source["outTag"];
	        this.outbound = source["outbound"];
	    }
	}
	export class RouteTestResult {
	    process: string;
	    url: string;
	    ok: boolean;
	    httpCode: number;
	    seconds: number;
	    error?: string;
	    route: string;
	    hops: RouteHop[];
	    logTrace?: string[];
	    note?: string;
	
	    static createFrom(source: any = {}) {
	        return new RouteTestResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.process = source["process"];
	        this.url = source["url"];
	        this.ok = source["ok"];
	        this.httpCode = source["httpCode"];
	        this.seconds = source["seconds"];
	        this.error = source["error"];
	        this.route = source["route"];
	        this.hops = this.convertValues(source["hops"], RouteHop);
	        this.logTrace = source["logTrace"];
	        this.note = source["note"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class RuleImportPreview {
	    schemaVersion: number;
	    ruleCount: number;
	    lineAdded: number;
	    lineSkipped: number;
	    customRules: number;
	    summary: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new RuleImportPreview(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schemaVersion = source["schemaVersion"];
	        this.ruleCount = source["ruleCount"];
	        this.lineAdded = source["lineAdded"];
	        this.lineSkipped = source["lineSkipped"];
	        this.customRules = source["customRules"];
	        this.summary = source["summary"];
	        this.error = source["error"];
	    }
	}
	export class RuleSetInfo {
	    name: string;
	    display: string;
	    desc: string;
	    sizeKB: number;
	    modified: string;
	    present: boolean;
	    enabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RuleSetInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.display = source["display"];
	        this.desc = source["desc"];
	        this.sizeKB = source["sizeKB"];
	        this.modified = source["modified"];
	        this.present = source["present"];
	        this.enabled = source["enabled"];
	    }
	}
	export class Settings {
	    mixedPort: number;
	    tunMode: boolean;
	    lanShare: boolean;
	    lanPort: number;
	    lanType: string;
	    lanUser: string;
	    lanPass: string;
	    excludeSelf: boolean;
	    privateDirect: boolean;
	    blockQUIC: boolean;
	    remoteDNS: boolean;
	    fakeIP: boolean;
	    autostart: boolean;
	    trayClose: boolean;
	    theme: string;
	    autoUpdateApp: boolean;
	    autoUpdateCoreOff?: boolean;
	    claudeAccelOff?: boolean;
	    claudeAccelAutoOff?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mixedPort = source["mixedPort"];
	        this.tunMode = source["tunMode"];
	        this.lanShare = source["lanShare"];
	        this.lanPort = source["lanPort"];
	        this.lanType = source["lanType"];
	        this.lanUser = source["lanUser"];
	        this.lanPass = source["lanPass"];
	        this.excludeSelf = source["excludeSelf"];
	        this.privateDirect = source["privateDirect"];
	        this.blockQUIC = source["blockQUIC"];
	        this.remoteDNS = source["remoteDNS"];
	        this.fakeIP = source["fakeIP"];
	        this.autostart = source["autostart"];
	        this.trayClose = source["trayClose"];
	        this.theme = source["theme"];
	        this.autoUpdateApp = source["autoUpdateApp"];
	        this.autoUpdateCoreOff = source["autoUpdateCoreOff"];
	        this.claudeAccelOff = source["claudeAccelOff"];
	        this.claudeAccelAutoOff = source["claudeAccelAutoOff"];
	    }
	}
	export class Stats {
	    running: boolean;
	    activeConns: number;
	    totalConns: number;
	    tracked: number;
	    upBytes: number;
	    downBytes: number;
	
	    static createFrom(source: any = {}) {
	        return new Stats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.running = source["running"];
	        this.activeConns = source["activeConns"];
	        this.totalConns = source["totalConns"];
	        this.tracked = source["tracked"];
	        this.upBytes = source["upBytes"];
	        this.downBytes = source["downBytes"];
	    }
	}
	export class Status {
	    coreRunning: boolean;
	    engineRunning: boolean;
	    corePort: number;
	    nodeName: string;
	    selectedId: string;
	    ruleMode: string;
	    uptimeSec: number;
	    stats: Stats;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.coreRunning = source["coreRunning"];
	        this.engineRunning = source["engineRunning"];
	        this.corePort = source["corePort"];
	        this.nodeName = source["nodeName"];
	        this.selectedId = source["selectedId"];
	        this.ruleMode = source["ruleMode"];
	        this.uptimeSec = source["uptimeSec"];
	        this.stats = this.convertValues(source["stats"], Stats);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Sub {
	    id: string;
	    name: string;
	    url: string;
	    autoUpdate: boolean;
	    lastUpdate: string;
	    nodeCount: number;
	
	    static createFrom(source: any = {}) {
	        return new Sub(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.url = source["url"];
	        this.autoUpdate = source["autoUpdate"];
	        this.lastUpdate = source["lastUpdate"];
	        this.nodeCount = source["nodeCount"];
	    }
	}

}

export namespace updater {
	
	export class Release {
	    version: string;
	    minimumVersion: string;
	    url: string;
	    sha256: string;
	    signature: string;
	    mandatory: boolean;
	    publishedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Release(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.minimumVersion = source["minimumVersion"];
	        this.url = source["url"];
	        this.sha256 = source["sha256"];
	        this.signature = source["signature"];
	        this.mandatory = source["mandatory"];
	        this.publishedAt = source["publishedAt"];
	    }
	}
	export class Status {
	    enabled: boolean;
	    current: string;
	    available: boolean;
	    release?: Release;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.current = source["current"];
	        this.available = source["available"];
	        this.release = this.convertValues(source["release"], Release);
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

