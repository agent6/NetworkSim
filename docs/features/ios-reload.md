# IOS reload and boot

Use privileged EXEC `reload`. When running configuration differs from startup configuration, answer the save question, then confirm the reload. Cancelling either confirmation leaves the device running.

Confirmed reload now resets runtime state and streams a shortened boot sequence through the console: bootstrap/boot loader, image loading, interface/service initialization, startup configuration, and **Press RETURN to get started!**. Startup takes 6.5 seconds of simulation time. The diagram shows an amber status light and **Booting…**. Interfaces on both ends of each affected link are unavailable during startup, so real simulated traffic stops.

The console is read-only while booting. Ctrl+C cannot abort an already confirmed boot. Press Enter when startup finishes to begin a new user EXEC session or the saved console login workflow. Previously open consoles lose their privilege/configuration context. A remote SSH/Telnet reload closes that network session; reconnect after boot to authenticate again. Boot-loader messages belong to the physical console.

`reload reason`, `reload in`, and `reload at` use the same lifecycle. `reload cancel` still cancels a scheduled restart before its deadline. WLC GUI reload uses this lifecycle too. Pausing the simulation pauses startup, and stepping events advances the same deterministic clock. Removing power or replacing the lab cancels the old boot callbacks.

AP software reload preserves its supplied PoE allocation. Its interfaces/radios remain unavailable until software startup completes; CAPWAP/client service then recovers through ordinary network dependencies. An AP without valid PoE cannot boot. A Phone remains a separate powered endpoint without an IOS console.

The configuration register still controls whether saved startup configuration is applied. A factory boot or startup bypass uses the existing factory configuration without erasing NVRAM. Project export preserves configuration, while transient boot/runtime state rebuilds on import.

This is an original shortened teaching sequence. It does not execute an IOS image or reproduce hardware POST, cryptographic image verification, ROMMON recovery, upgrade/install operations or the full initial setup wizard. The symbolic `flash:packages.conf` line describes a boot stage rather than a real executable file.

The console entry and setup distinctions were reviewed against Cisco's [IOS XE basic configuration guide](https://www.cisco.com/c/en/us/td/docs/routers/ios/config/17-x/syst-mgmt/b-system-management/m_cf-config-overview-0.html) and [IOS XE console usage guide](https://www.cisco.com/c/en/us/td/docs/routers/access/isr1100/software/configuration/guide/isr1100-sw-config/using_iosxe_software.html). Full native output equivalence is not asserted.

Implementation: `src/ios-boot.ts`, `Simulator.reloadIOS`, and the shared `IOSSession`/console. `Simulator.reload` remains the immediate internal reset primitive used by setup and lower-level protocol fixtures. Tests are in `tests/ios-boot.test.ts`; the direct-disk browser workflow is `scripts/browser-ios-boot.mjs`.
