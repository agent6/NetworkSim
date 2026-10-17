import {ftpFormFields,ftpDraft,bindFTPForm} from './ftp-ui.ts';
import {ownRecordValue,setRecordValue} from './record-map.ts';
import {dnsRecords,validateDNSRecords,type DNSRecord} from './dns-service.ts';
import type { Device } from "./model.ts";
import type { Simulator } from "./engine.ts";
import { isIPv4, isIPv6, ipToInt, networkAddress, inSubnet } from "./ip.ts";
import { escapeHTML as esc, icon } from "./icons.ts";

type FormDialog = (
  title: string,
  content: string,
  save: (data: FormData) => void,
  label?: string,
) => void;
const input = (label: string, name: string, value: unknown, placeholder = "") =>
  `<label class="field">${esc(label)}<input name="${name}" value="${esc(value ?? "")}" placeholder="${esc(placeholder)}"></label>`;
const toggle = (name: string, label: string, enabled: boolean) =>
  `<label class="flex items-center gap-2 text-xs"><input type="checkbox" name="${name}" ${enabled ? "checked" : ""}>${label}</label>`;
const dnsRow = (record:Partial<DNSRecord> = {}) =>
  `<div class="rounded-xl border border-slate-200 p-3" data-dns-row><div class="grid grid-cols-[1fr_100px_30px] items-end gap-2">${input("Record name", "record-name", record.name, "intranet.lab")}<label class="field">Type<select name="record-type">${['A','AAAA','CNAME','MX','NS','PTR'].map(type=>`<option ${(record.type??'A')===type?'selected':''}>${type}</option>`).join('')}</select></label><button class="icon-btn" type="button" data-remove-row aria-label="Remove DNS record">${icon("trash", 15)}</button></div><div class="mt-3 grid grid-cols-[1fr_100px_120px] gap-2">${input("Address or target name", "record-address", record.value)}<label class="field">TTL (seconds)<input type="number" min="0" max="2147483647" name="record-ttl" value="${record.ttl??300}"></label><label class="field">MX preference<input type="number" min="0" max="65535" name="record-preference" value="${record.preference??10}"></label></div></div>`;
const poolRow = (p: any = {}) =>
  `<div class="rounded-xl border border-slate-200 bg-slate-50/50 p-3" data-pool-row><div class="mb-3 flex items-center justify-between"><span class="section-label">Address pool</span><button class="icon-btn" type="button" data-remove-row aria-label="Remove DHCP pool">${icon("trash", 15)}</button></div><div class="grid grid-cols-2 gap-3">${input("Pool name", "pool-name", p.name, "OFFICE")}${input("Network address", "pool-network", p.network, "192.168.10.0")}${input("Prefix length", "pool-prefix", p.prefix ?? 24)}${input("Default gateway", "pool-gateway", p.defaultRouter)}${input("DNS servers, separated by commas", "pool-dns", (p.dnsServers || []).join(", "))}${input("Lease duration (seconds)", "pool-lease", p.leaseSeconds ?? 86400)}</div></div>`;
const fileRow = (path = "", body = "") =>
  `<div class="rounded-xl border border-slate-200 p-3" data-file-row><div class="flex items-end gap-2"><div class="flex-1">${input("Path", "http-path", path, "/about.html")}</div><button class="icon-btn" type="button" data-remove-row aria-label="Remove HTTP file">${icon("trash", 15)}</button></div><label class="field mt-3">HTML or text<textarea name="http-body" rows="4" class="font-mono text-xs">${esc(body)}</textarea></label></div>`;


const aaaRow = (protocol: string, user = "", record: any = {}) =>
  `<div class="grid grid-cols-[1fr_1fr_65px_30px] items-end gap-2" data-aaa-row>${input("Username", protocol + "-user", user)}<label class="field">Lab password<input type="password" autocomplete="off" name="${protocol}-password" value="${esc(record.password || "")}"></label>${input("Privilege", protocol + "-privilege", record.privilege ?? 1)}<button class="icon-btn" type="button" data-remove-row aria-label="Remove AAA user">${icon("trash", 15)}</button></div>`;
const aaaSection = (protocol: string, label: string, svc: any) =>
  `<div class="space-y-3 rounded-xl border border-slate-200 p-3">${toggle(protocol + "-enabled", label + " server enabled", svc?.enabled)}<label class="field">${label} shared secret<input type="password" autocomplete="off" name="${protocol}-secret" value="${esc(svc?.secret || "")}"></label><div id="${protocol}-users" class="space-y-3">${Object.entries(
    svc?.users || {},
  )
    .map(([user, record]) => aaaRow(protocol, user, record))
    .join(
      "",
    )}</div><button class="btn" type="button" data-add-aaa="${protocol}">${icon("plus", 14)} Add ${label} user</button></div>`;

function leaseDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function accountingView(d:Device):string{
  const records:any[]=d.runtime.features.aaaAccountingReceived??[],stats=d.runtime.features.aaaAccountingReceiverStats??{};
  return `<div class="section-label mb-2">Received accounting records</div><p class="mb-2 text-[11px] text-slate-400">${records.length} stored · ${stats.duplicates??0} duplicate retries · ${stats.rejected??0} rejected. RADIUS supports EXEC; TACACS+ also supports command records.</p><pre class="max-h-52 overflow-auto rounded-lg bg-slate-50 p-3 text-[10px] whitespace-pre-wrap">${esc(records.slice(-100).map(row=>`sim ${row.received} ms ${row.protocol} ${row.source} ${row.username||'(line)'} ${row.line} ${row.kind} ${row.status} session=${row.sessionId}${row.command?' command='+row.command:''}${row.reason?' reason='+row.reason:''}`).join('\n')||'No accounting records received.')}</pre>`;
}

function dhcpLeaseView(d: Device, sim: Simulator, filter = ""): string {
  const now = sim.clock.now(), query = filter.trim().toLowerCase();
  const leases: any[] = (d.runtime.features.dhcpLeases ?? []).filter((lease: any) => lease.expires > now);
  const rows = leases.map((lease: any) => {
    const client = sim.getDevice(lease.clientId);
    const port = client && Object.keys(client.config.interfaces).find(name => {
      const binding = client.runtime.features.dhcpClientLeases?.[name];
      return binding?.serverId === d.id && binding.address === lease.address;
    });
    const mac = client && port ? sim.macOf(client.id, port) : "";
    return { lease, client: client?.config.hostname ?? lease.clientId, mac };
  }).filter(row => [row.lease.address, row.client, row.lease.clientId, row.mac, row.lease.pool].some(value => String(value ?? "").toLowerCase().includes(query)))
    .sort((a, b) => ipToInt(a.lease.address) - ipToInt(b.lease.address));
  return `<div class="flex items-center justify-between gap-3"><span class="section-label">Active leases</span><span class="text-xs text-slate-500" data-dhcp-lease-count>${query ? `${rows.length} of ${leases.length}` : leases.length} ${leases.length === 1 ? "lease" : "leases"}</span></div>
    ${rows.length ? `<div class="wireless-table-wrap"><table class="wireless-table" aria-label="DHCP leases"><thead><tr><th scope="col">IP address</th><th scope="col">Client</th><th scope="col">Pool</th><th scope="col">Remaining</th></tr></thead><tbody>${rows.map(({lease,client,mac}) => `<tr data-dhcp-lease="${esc(lease.address)}"><td class="font-mono whitespace-nowrap">${esc(lease.address)}</td><td>${esc(client)}<small class="font-mono">${esc(mac || lease.clientId)}</small></td><td>${esc(lease.pool)}</td><td class="whitespace-nowrap" data-lease-remaining>${leaseDuration(lease.expires - now)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="rounded-xl border border-slate-200 p-4 text-xs text-slate-500" data-dhcp-lease-empty>${query ? "No leases match your search." : "No active leases. Clients will appear here after this server allocates an address."}</p>`}`;
}

export function showServices(
  d: Device,
  formDialog: FormDialog,
  commit: (work: () => void) => void,
  sim: Simulator,
) {
  const svc = d.config.services;
  formDialog(
    `${d.config.hostname} · Services`,
    `
    <div class="flex flex-wrap gap-1 border-b border-slate-100 pb-3" role="tablist" aria-label="Server services">${["DNS", "DHCP", "HTTP", "AAA", "NTP", "FTP", "Syslog"].map((label, i) => `<button class="btn ${i === 0 ? "tool-active" : ""}" type="button" role="tab" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-service-tab="${label}">${label}</button>`).join("")}</div>
    <section data-service-section="DNS" class="space-y-3">${toggle("dns-enabled", "DNS server enabled", svc.dns?.enabled)}<p class="text-[11px] leading-5 text-slate-400">Serve A, AAAA, CNAME, MX, NS and PTR records through simulated DNS. TTL controls resolver caching. Enter reverse-zone names for PTR records; MX preference applies only to MX.</p><div id="dns-rows" class="space-y-3">${dnsRecords(svc.dns).map(record=>dnsRow(record)).join('')}</div><button type="button" class="btn" id="add-dns">${icon("plus", 14)} Add record</button></section>
    <section data-service-section="DHCP" class="hidden space-y-3">${toggle("dhcp-enabled", "DHCP server enabled", svc.dhcp?.enabled)}<div class="space-y-3 rounded-xl border border-slate-200 p-3"><label class="field">Find a lease<input type="search" data-dhcp-lease-search aria-label="Search DHCP leases" placeholder="IP address, client, MAC address, or pool"></label><div class="space-y-3" data-dhcp-leases>${dhcpLeaseView(d,sim)}</div><p class="text-[11px] text-slate-400">Live allocations from this server. Remaining time follows the simulation clock.</p></div><div id="pool-rows" class="space-y-3">${(svc.dhcp?.pools || []).map(poolRow).join("")}</div><button type="button" class="btn" id="add-pool">${icon("plus", 14)} Add address pool</button><label class="field">Excluded addresses · one address or start–end range per line<textarea name="dhcp-excluded" rows="3" class="font-mono text-xs" placeholder="192.168.10.1 - 192.168.10.20">${esc((svc.dhcp?.excluded || []).map((r: any) => (r.start === r.end ? r.start : `${r.start} - ${r.end}`)).join("\n"))}</textarea></label></section>
    <section data-service-section="HTTP" class="hidden space-y-3">${toggle("http-enabled", "HTTP server enabled", svc.http?.enabled)}<div class="grid grid-cols-2 gap-3"><label class="field">HTTP authentication<select name="http-auth">${["none", "local", "enable", "aaa"].map((mode) => `<option value="${mode}" ${(svc.http?.authentication || "none") === mode ? "selected" : ""}>${{ none: "Public", local: "Local users", enable: "Enable password", aaa: "AAA method list" }[mode]}</option>`).join("")}</select></label>${input("AAA login method list", "http-auth-list", svc.http?.authenticationList || "default")}${input("Flash base path (optional)", "http-base", svc.http?.basePath || "", "flash:/www")}<label class="field">Enable password (lab only)<input type="password" autocomplete="off" name="http-enable-password" value="${esc(d.config.features.enableSecret ?? d.config.features.enablePassword ?? "")}"></label></div><details><summary class="cursor-pointer text-xs">Local device users</summary><p class="my-2 text-[11px] text-slate-400">Use lab-only credentials. These users are also available to device login; exported labs include them.</p><div id="http-local-users" class="space-y-3">${Object.entries(
      d.config.features.users || {},
    )
      .map(([user, record]: [string, any]) =>
        aaaRow("http-local", user, {
          password: record.secret ?? record.password,
          privilege: record.privilege ?? 1,
        }),
      )
      .join(
        "",
      )}</div><button class="btn mt-3" type="button" data-add-aaa="http-local">${icon("plus", 14)} Add local user</button></details><label class="field">Home page · /<textarea name="html" rows="7" class="font-mono text-xs">${esc(svc.http?.content || "<h1>Welcome to the lab</h1><p>Your network is working.</p>")}</textarea></label><div id="http-files" class="space-y-3">${Object.entries(
      svc.http?.files || {},
    )
      .filter(([path]) => path !== "/")
      .map(([path, body]) => fileRow(path, String(body)))
      .join(
        "",
      )}</div><button type="button" class="btn" id="add-http-file">${icon("plus", 14)} Add page</button><p class="text-[11px] leading-5 text-slate-400">Pages are served inside the simulation. Scripts and external resources are disabled in the simulated browser.</p></section>
    <section data-service-section="AAA" class="hidden space-y-3"><p class="text-[11px] leading-5 text-slate-400">Authentication and accounting requests travel through your simulated network. Use lab-only passwords; lab exports include these values.</p>${aaaSection("radius", "RADIUS", svc.radius)}${aaaSection("tacacs", "TACACS+", svc.tacacs)}<div data-aaa-accounting>${accountingView(d)}</div></section>
    <section data-service-section="NTP" class="hidden space-y-3"><div class="grid grid-cols-2 items-end gap-3">${toggle("ntp-enabled", "NTP server enabled", svc.ntp?.enabled)}${input("NTP stratum", "stratum", svc.ntp?.stratum || 1)}</div></section>


    <section data-service-section="FTP" class="hidden space-y-3">${ftpFormFields(svc.ftp)}</section>
    <section data-service-section="Syslog" class="hidden space-y-3">${toggle("syslog-enabled", "Syslog receiver enabled", svc.syslog?.enabled)}<div><div class="section-label mb-2">Received logs</div><pre class="max-h-44 overflow-auto rounded-lg bg-slate-50 p-3 text-[10px] whitespace-pre-wrap">${esc((d.runtime.features.syslogReceived || []).map((entry: any) => `${entry.timestamp ?? `sim ${entry.received ?? 0} ms`} ${entry.source}${entry.hostname ? ` (${entry.hostname})` : ""} facility=${entry.facility ?? "?"} severity=${entry.severity ?? "?"}: ${entry.message}`).join("\n") || "No messages received.")}</pre></div></section>`,
    (data) => {
      const records:Record<string,string>=Object.create(null),names=data.getAll("record-name"),addresses=data.getAll("record-address");
      const resourceRecords=validateDNSRecords(names.flatMap((name,i)=>{
        const host=String(name).trim(),value=String(addresses[i]??'').trim();if(!host&&!value)return [];
        const type=String(data.getAll('record-type')[i]??(isIPv6(value)?'AAAA':'A')) as DNSRecord['type'];
        return [{name:host,type,value,ttl:Number(data.getAll('record-ttl')[i]??300),...type==='MX'?{preference:Number(data.getAll('record-preference')[i]??10)}:{}}];
      }));
      for(const r of resourceRecords)if((r.type==='A'||r.type==='AAAA')&&!Object.hasOwn(records,r.name))setRecordValue(records,r.name,r.value);
      const namesPool = data.getAll("pool-name");
      const pools = namesPool.map((name, i) => ({
        ...(svc.dhcp?.pools || []).find(
          (pool: any) => pool.name === String(name).trim(),
        ),
        name: String(name).trim(),
        network: String(data.getAll("pool-network")[i]).trim(),
        prefix: Number(data.getAll("pool-prefix")[i]),
        defaultRouter:
          String(data.getAll("pool-gateway")[i]).trim() || undefined,
        dnsServers: String(data.getAll("pool-dns")[i])
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        leaseSeconds: Number(data.getAll("pool-lease")[i]),
      }));
      if (
        pools.some(
          (p) =>
            !p.name ||
            !isIPv4(p.network) ||
            !Number.isInteger(p.prefix) ||
            p.prefix < 1 ||
            p.prefix > 30 ||
            (p.defaultRouter && !isIPv4(p.defaultRouter)) ||
            p.dnsServers.some((ip: string) => !isIPv4(ip)) ||
            !Number.isFinite(p.leaseSeconds) ||
            !Number.isInteger(p.leaseSeconds) ||
            p.leaseSeconds < 60,
        )
      )
        throw Error(
          "Check DHCP pool names, addresses, prefix lengths (1–30), and lease times (at least 60 seconds).",
        );
      if (new Set(pools.map((p) => p.name)).size !== pools.length)
        throw Error("DHCP pool names must be unique.");
      for (const pool of pools) {
        if (networkAddress(pool.network, pool.prefix) !== pool.network)
          throw Error(`DHCP pool ${pool.name} needs a network address with no host bits set.`);
        if (pool.defaultRouter && !inSubnet(pool.defaultRouter, pool.network, pool.prefix))
          throw Error(`The gateway for DHCP pool ${pool.name} must belong to its subnet.`);
      }
      const excluded = String(data.get("dhcp-excluded"))
        .split("\n")
        .filter((s) => s.trim())
        .map((line) => {
          const range = line.trim().split(/\s*[-–]\s*/);
          const start = range[0],
            end = range[1] || start;
          if (range.length > 2 || !isIPv4(start) || !isIPv4(end))
            throw Error("Check the DHCP exclusion addresses.");
          if (ipToInt(end) < ipToInt(start))
            throw Error("A DHCP exclusion range must end at or after its starting address.");
          return { start, end };
        });
      const files: Record<string, string> = Object.create(null);
      data.getAll("http-path").forEach((path, i) => {
        const name = String(path).trim();
        if (
          !name.startsWith("/") ||
          name.includes("..") ||
          name === "/" ||
          Object.hasOwn(files,name)
        )
          throw Error(
            "Additional HTTP pages need unique paths beginning with /, such as /about.html.",
          );
        files[name] = String(data.getAll("http-body")[i]);
      });
      const stratum = Number(data.get("stratum"));
      if (!Number.isInteger(stratum) || stratum < 1 || stratum > 15)
        throw Error("NTP stratum must be 1–15.");
      const aaa: Record<string, any> = {};
      for (const protocol of ["radius", "tacacs", "http-local"]) {
        const users: Record<string, { password: string; privilege: number }> =
          Object.create(null);
        data.getAll(protocol + "-user").forEach((raw, i) => {
          const user = String(raw).trim(),
            password = String(data.getAll(protocol + "-password")[i]??''),
            privilege = Number(data.getAll(protocol + "-privilege")[i]);
          if (
            !user ||
            !password ||
            !Number.isInteger(privilege) ||
            privilege < 0 ||
            privilege > 15
          )
            throw Error(
              "AAA users need a username, password, and privilege from 0–15.",
            );
          if (Object.hasOwn(users,user))
            throw Error("AAA usernames must be unique per service.");
          users[user] = { password, privilege };
        });
        aaa[protocol] = {
          enabled: data.has(protocol + "-enabled"),
          secret: String(data.get(protocol + "-secret")??''),
          users,
        };
        if (aaa[protocol].enabled && !aaa[protocol].secret)
          throw Error("Enabled AAA services need a shared secret.");
      }
      const httpBase = String(data.get("http-base")).trim();
      if (
        httpBase.split("/").includes("..") ||
        /[\u0000-\u001f\\]/.test(httpBase)
      )
        throw Error(
          "Use a simulated flash directory without parent path segments.",
        );
      const ftp=ftpDraft(data,d.config);
      commit(() => {
        if(ftp!==undefined)svc.ftp=ftp;
        const localUsers: Record<string, any> = Object.create(null);
        for (const [user, value] of Object.entries<any>(
          aaa["http-local"].users,
        )) {
          const previous = ownRecordValue(d.config.features.users,user);
          localUsers[user] =
            previous?.secret !== undefined
              ? {
                  ...previous,
                  secret: value.password,
                  privilege: value.privilege,
                }
              : { ...previous, ...value };
        }
        d.config.features.users = localUsers;
        const enable = String(data.get("http-enable-password")??'');
        if (!enable) {
          delete d.config.features.enableSecret;
          delete d.config.features.enablePassword;
          delete d.config.features.enablePasswordType;
        } else if (d.config.features.enableSecret !== undefined)
          d.config.features.enableSecret = enable;
        else if (enable || d.config.features.enablePassword !== undefined)
          d.config.features.enablePassword = enable;
        svc.radius = { ...svc.radius, ...aaa.radius };
        svc.tacacs = { ...svc.tacacs, ...aaa.tacacs };
        svc.dns = { ...svc.dns, enabled: data.has("dns-enabled"), records, resourceRecords };
        svc.dhcp = {
          ...svc.dhcp,
          enabled: data.has("dhcp-enabled"),
          pools,
          excluded,
        };
        svc.http = {
          ...svc.http,
          enabled: data.has("http-enabled"),
          authentication: String(data.get("http-auth")),
          authenticationList:
            String(data.get("http-auth-list")).trim() || "default",
          basePath: httpBase || undefined,
          content: String(data.get("html")),
          files,
        };
        svc.ntp = { ...svc.ntp, enabled: data.has("ntp-enabled"), stratum };
        if (svc.tftp) svc.tftp.enabled = false;
        svc.syslog = { ...svc.syslog, enabled: data.has("syslog-enabled") };
        if (svc.sshFiles) svc.sshFiles.enabled = false;
      });
    },
  );
  const root = document.querySelector<HTMLFormElement>("#dialog-form")!;
  bindFTPForm(root);
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-service-tab]")];
  const sections = [...root.querySelectorAll<HTMLElement>("[data-service-section]")];
  tabs.forEach((tab, index) => {
    const section = sections.find(panel => panel.dataset.serviceSection === tab.dataset.serviceTab);
    tab.id = `service-tab-${index}`;
    if (section) {
      section.id = `service-panel-${index}`;
      section.setAttribute("role", "tabpanel");
      section.setAttribute("aria-labelledby", tab.id);
      tab.setAttribute("aria-controls", section.id);
    }
  });
  const refreshLeases = () => {
    const output = root.querySelector<HTMLElement>("[data-dhcp-leases]");
    if (!output) return;
    const markup = dhcpLeaseView(d, sim, root.querySelector<HTMLInputElement>("[data-dhcp-lease-search]")?.value);
    if (output.innerHTML !== markup) output.innerHTML = markup;
  };
  const refreshAccounting=()=>{const output=root.querySelector<HTMLElement>('[data-aaa-accounting]');if(output){const markup=accountingView(d);if(output.innerHTML!==markup)output.innerHTML=markup;}};
  root.querySelector("[data-dhcp-lease-search]")?.addEventListener("input", refreshLeases);
  const off = sim.subscribe(() => {
    if (!root.isConnected || sim.getDevice(d.id) !== d) { off(); return; }
    if (!sections.find(panel => panel.dataset.serviceSection === "DHCP")?.classList.contains("hidden")) refreshLeases();
    if (!sections.find(panel => panel.dataset.serviceSection === "AAA")?.classList.contains("hidden")) refreshAccounting();
  });
  root.addEventListener("keydown", (event) => {
    const current = tabs.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    const next = event.key === "ArrowRight" ? (current + 1) % tabs.length : event.key === "ArrowLeft" ? (current + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); tabs[next].click(); tabs[next].focus(); }
  });
  root.addEventListener("click", (event) => {
    const target = event.target as Element,
      tab = target.closest<HTMLElement>("[data-service-tab]");
    if (tab) {
      for (const section of sections)
        section.classList.toggle(
          "hidden",
          section.dataset.serviceSection !== tab.dataset.serviceTab,
        );
      for (const b of tabs) {
        b.classList.toggle("tool-active", b === tab);
        b.setAttribute("aria-selected", String(b === tab));
        b.tabIndex = b === tab ? 0 : -1;
      }
      if (tab.dataset.serviceTab === "DHCP") refreshLeases();
      if (tab.dataset.serviceTab === "AAA") refreshAccounting();
    }
    if (target.closest("[data-remove-row]"))
      target
        .closest(
          "[data-dns-row],[data-pool-row],[data-file-row],[data-aaa-row]",
        )
        ?.remove();
    const addAAA = target.closest<HTMLElement>("[data-add-aaa]");
    if (addAAA)
      root
        .querySelector("#" + addAAA.dataset.addAaa + "-users")!
        .insertAdjacentHTML("beforeend", aaaRow(addAAA.dataset.addAaa!));
    if (target.closest("#add-dns"))
      root
        .querySelector("#dns-rows")!
        .insertAdjacentHTML("beforeend", dnsRow());
    if (target.closest("#add-pool"))
      root
        .querySelector("#pool-rows")!
        .insertAdjacentHTML("beforeend", poolRow());
    if (target.closest("#add-http-file"))
      root
        .querySelector("#http-files")!
        .insertAdjacentHTML("beforeend", fileRow());
  });
}
