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
	
	
	export class RuleSetInfo {
	    name: string;
	    display: string;
	    desc: string;
	    sizeKB: number;
	    modified: string;
	    present: boolean;
	
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

