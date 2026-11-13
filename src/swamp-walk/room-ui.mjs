// The room window of «Первый причал» (docs/design/multiplayer.md, stage 2): a nickname, a pouch colour and the invite
// link, on the same plank as the sortie board's decisions. Made from candidate C's profile window (profile-ui.mjs);
// the texts are content/swamp-walk.json → room. Only the DOM lives here; walk-room.mjs opens the room itself.

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function action(text, className = "") {
  const node = el("button", className, text);
  node.type = "button";
  return node;
}

// `colors` is { copper: "#hex", ... }; `parse(value)` checks a profile; the handlers get the checked profile.
export function createRoomDialog(world, copy, colors, parse, { onInvite, onJoin, onLeave }) {
  const dialog = el("dialog", "walk-decision walk-room");
  dialog.id = "swalk-room-dialog";
  const title = el("h2");
  title.id = "swalk-room-title";
  dialog.setAttribute("aria-labelledby", title.id);
  const lead = el("p");

  const form = el("form", "walk-room-form");
  form.noValidate = true;
  const nickLabel = el("label", "walk-room-field", copy.nick);
  const nick = el("input");
  nick.type = "text";
  nick.name = "nick";
  nick.autocomplete = "nickname";
  nick.maxLength = 40;
  nick.spellcheck = false;
  nickLabel.append(nick);
  const swatches = el("fieldset", "walk-room-swatches");
  swatches.append(el("legend", "", copy.color));
  const radios = Object.entries(colors).map(([name, hex]) => {
    const choice = el("label", "walk-swatch");
    choice.style.setProperty("--pouch", hex);
    const radio = el("input");
    radio.type = "radio";
    radio.name = "color";
    radio.value = name;
    choice.append(radio, el("span", "", copy.colors[name] ?? name));
    swatches.append(choice);
    return radio;
  });
  const error = el("p", "walk-room-error");
  error.setAttribute("role", "alert");
  form.append(nickLabel, swatches, error);

  const status = el("p", "walk-room-status");
  status.setAttribute("role", "status");
  const invite = el("div", "walk-room-link");
  invite.hidden = true;
  const linkLabel = el("label", "walk-room-field", copy.link);
  const link = el("input");
  link.readOnly = true;
  link.name = "link";
  linkLabel.append(link);
  const copyLink = action(copy.copy);
  const shareLink = action(copy.share);
  shareLink.hidden = typeof navigator.share !== "function";
  invite.append(linkLabel, shareLink, copyLink);

  const options = el("div", "walk-room-options");
  const primary = action(copy.invite);
  const leave = action(copy.leave);
  const close = action(copy.close);
  options.append(primary, leave, close);
  dialog.append(title, lead, form, status, invite, options);
  world.append(dialog);

  let mode = "invite";
  const chosen = () => radios.find(radio => radio.checked)?.value;
  function read() {
    const profile = parse({ nick: nick.value, color: chosen() });
    error.textContent = profile ? "" : copy.badNick;
    if (!profile) nick.focus();
    return profile;
  }
  function show(next, { profile, url = "", state = "" } = {}) {
    mode = next;
    const inRoom = mode === "room";
    title.textContent = mode === "join" ? copy.titleJoin : copy.title;
    lead.textContent = mode === "join" ? copy.leadJoin : copy.lead;
    form.hidden = inRoom;
    if (profile) {
      nick.value = profile.nick;
      for (const radio of radios) radio.checked = radio.value === profile.color;
    }
    error.textContent = "";
    primary.hidden = inRoom;
    primary.textContent = mode === "join" ? copy.join : copy.invite;
    leave.hidden = !inRoom;
    setLink(url);
    setStatus(state);
    if (!dialog.open) dialog.showModal();
  }
  function setLink(url) {
    invite.hidden = !url;
    if (link.value !== url) link.value = url;
  }
  function setStatus(text) {
    if (status.textContent !== text) status.textContent = text;
    status.hidden = !text;
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    primary.click();
  });
  primary.addEventListener("click", () => {
    const profile = read();
    if (!profile) return;
    if (mode === "join") {
      dialog.close();
      onJoin(profile);
    } else onInvite(profile);
  });
  leave.addEventListener("click", () => {
    dialog.close();
    onLeave();
  });
  close.addEventListener("click", () => dialog.close());
  copyLink.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link.value);
      setStatus(copy.copied);
    } catch {
      link.focus();
      link.select();
      setStatus(copy.copyByHand);
    }
  });
  shareLink.addEventListener("click", () => {
    navigator.share?.({ title: document.title, url: link.value }).catch(() => {});
  });
  // back to the scene after the window, so the canvas keeps the keys and no button keeps a focus ring
  dialog.addEventListener("close", () => document.getElementById("swalk-view")?.focus({ preventScroll: true }));

  return { show, setLink, setStatus, get open() { return dialog.open; }, get mode() { return mode; } };
}
