package nodes

import "testing"

func TestClashSmuxBrutalAndSSPlugin(t *testing.T) {
	list, err := ParseClashYAML([]byte(`
proxies:
  - name: ss1
    type: ss
    server: a.com
    port: 8388
    cipher: aes-128-gcm
    password: p
    plugin: obfs
    plugin-opts: {mode: tls, host: bing.com}
    smux:
      enabled: true
      protocol: h2mux
      max-connections: 4
      brutal-opts: {enabled: true, up: "50 Mbps", down: 1 Gbps}
  - name: ss2
    type: ss
    server: b.com
    port: 8388
    cipher: aes-128-gcm
    password: p
    plugin: shadow-tls
`))
	if err != nil || len(list) != 2 {
		t.Fatal(err)
	}
	a := list[0]
	if a.Plugin != "obfs-local" || a.PluginOpts != "obfs=tls;obfs-host=bing.com" {
		t.Fatalf("plugin %q %q", a.Plugin, a.PluginOpts)
	}
	b, _ := a.Multiplex["brutal"].(map[string]any)
	if a.Multiplex["protocol"] != "h2mux" || a.Multiplex["max_connections"] != 4 || b["up_mbps"] != 50 || b["down_mbps"] != 1000 {
		t.Fatalf("multiplex %v", a.Multiplex)
	}
	if list[1].Plugin != "" || list[1].Name != "ss2（插件 shadow-tls 不支持）" {
		t.Fatalf("unsupported plugin: %+v", list[1])
	}
}

func TestSSLinkPlugin(t *testing.T) {
	n, err := ParseLink("ss://YWVzLTEyOC1nY206cA@a.com:8388/?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dx.com#n")
	if err != nil {
		t.Fatal(err)
	}
	if n.Plugin != "obfs-local" || n.PluginOpts != "obfs=http;obfs-host=x.com" || n.Server != "a.com" {
		t.Fatalf("%+v", n)
	}
}

func TestParseSingboxJSON(t *testing.T) {
	list, err := ParseSingboxJSON([]byte(`{"outbounds":[
 {"type":"selector","tag":"sel","outbounds":["hk"]},
 {"type":"vless","tag":"hk","server":"hk.a.com","server_port":443,"uuid":"u","detour":"front"},
 {"type":"shadowsocks","tag":"front","server":"f.a.com","server_port":1,"method":"aes-128-gcm","password":"p"},
 {"type":"direct","tag":"direct"}]}`))
	if err != nil || len(list) != 2 {
		t.Fatalf("%v %d", err, len(list))
	}
	if list[0].EntryTag != "hk" || len(list[0].Outbounds) != 2 || list[0].Server != "hk.a.com" || list[0].Official {
		t.Fatalf("%+v", list[0])
	}
}
