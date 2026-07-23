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

export namespace engine {
	
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
	    paidAt: string;
	    expiresAt: string;
	    createdAt: string;
	
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
	        this.paidAt = source["paidAt"];
	        this.expiresAt = source["expiresAt"];
	        this.createdAt = source["createdAt"];
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
	    order: license.Order;
	    err?: string;
	
	    static createFrom(source: any = {}) {
	        return new OrderResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
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
	    latency: number;
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
	        this.latency = source["latency"];
	        this.speed = source["speed"];
	        this.subId = source["subId"];
	        this.raw = source["raw"];
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
	
	export class AppRule {
	    match: string;
	    path: string;
	    line: string;
	    node?: string;
	    enabled: boolean;
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
	        this.action = source["action"];
	        this.follow = source["follow"];
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
	    autoUpdateRules: boolean;
	    autoUpdateApp: boolean;
	
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
	        this.autoUpdateRules = source["autoUpdateRules"];
	        this.autoUpdateApp = source["autoUpdateApp"];
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
	    stats: engine.Stats;
	
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
	        this.stats = this.convertValues(source["stats"], engine.Stats);
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
