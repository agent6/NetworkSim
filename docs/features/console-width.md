# Console width

The browser console supplies its measured character width to the active session. Measurement uses the terminal's monospace font, available space, padding and scrollbar gutter. New output follows the current window size; it is no longer forced to 80 columns when there is room for a wider table.

The transcript preserves spaces and line boundaries. Browser word wrapping is disabled. Output is formatted once at the session width, and the pager counts those existing rows without wrapping them again. Existing transcript rows remain intact when the window changes size; rows wider than the panel are horizontally scrollable.

Explicit IOS session and line widths take precedence over automatic sizing:

```text
show terminal
terminal width 132
terminal width 0
```

`show terminal` reports the session's effective columns. `terminal width 132` fixes its width even in a narrower window. `terminal width 0` disables output wrapping and allows horizontal scrolling for long rows, including paged output. Terminal length and width are independent: `terminal length 0` disables paging. Session overrides do not change the saved device configuration.

Windows, Linux and macOS desktop shells use the attached console's columns. Simulated SSH and Telnet carry size metadata to the remote IOS session on their existing packet-driven requests. Remote explicit widths and configured VTY line widths still take precedence. Native SSH cryptography and binary terminal window messages are outside the existing management transport model.

The unbound IOS CLI retains its 80-column fallback. Cisco describes that default and the width command in its [IOS XE CLI guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/configuration/xe-16/fundamentals-xe-16-book/cf-cli-basics.html). The browser attachment supplies the actual size instead of relying on that fallback.

See [validation evidence](../testing/console-width-validation.md).
