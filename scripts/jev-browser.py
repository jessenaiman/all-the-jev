"""Use the installed Jev Ultrafast policy and guards on an existing Chrome tab.

Node owns credentials, outbound consent and the request ledger. This process
never calls a model service directly and never opens or closes a browser tab.
"""
import json
import os
import sys

sys.path.insert(0, sys.argv[1])
from browser_harness.helpers import cdp, list_tabs
from jev_ultrafast.browser import Browser, StalePage
from jev_ultrafast import model

os.environ["TYPESAFE_API_KEY"] = "handled-by-local-gateway"
browser = None
page = None
decision = None
prepared = None
history = []
goal = ""
preview = False


def emit(value):
    print(json.dumps(value), flush=True)


class PreviewReady(Exception):
    pass


def local_model(_url, _key, body):
    global prepared
    if preview:
        if len(json.dumps(body)) > 32000 or any(len(q["criteria"]) > 255 for q in body["questions"].values()):
            raise ValueError("Observation exceeds the bounded request budget. Narrow the visible browser content before previewing.")
        prepared = body
        raise PreviewReady()
    if body != prepared:
        raise ValueError("Browser state or goal changed. Preview the request again.")
    emit({"inference": body})
    response = json.loads(sys.stdin.readline())
    if response.get("error"):
        raise ValueError(response["error"])
    return response["result"]


model.post_json = local_model


class ExistingTab(Browser):
    def __init__(self, target):
        self.target = target
        self.session = cdp("Target.attachToTarget", targetId=target, flatten=True)["sessionId"]

    def close(self):
        cdp("Target.detachFromTarget", sessionId=self.session)


def snapshot():
    return {"page": page, "decision": decision, "request": prepared,
            "history": history, "goal": goal, "recording": False}


def command(value):
    global browser, page, decision, prepared, history, goal, preview
    name = value["command"]
    os.environ["TYPESAFE_MODEL"] = value.get("model", "jev-latest")
    if name == "tabs":
        return {"tabs": list_tabs(include_chrome=False), "recording": False}
    if name == "observe":
        target = value.get("targetId")
        if not isinstance(target, str) or not any(t["targetId"] == target for t in list_tabs(False)):
            raise ValueError("Choose an existing Chrome tab.")
        if not browser or browser.target != target:
            if browser:
                browser.close()
            browser = ExistingTab(target)
            history = []
        page = browser.observe(screenshot=False)
        decision = prepared = None
        return snapshot()
    if not browser or not page:
        raise ValueError("Observe a Chrome tab first.")
    if name == "preview":
        goal = value.get("goal", "").strip()
        if not goal or len(goal) > 2000:
            raise ValueError("Enter a goal of 1–2,000 characters.")
        page = browser.observe(screenshot=False)
        decision = prepared = None
        preview = True
        try:
            model.choose(page, goal, history)
        except PreviewReady:
            pass
        finally:
            preview = False
        return snapshot()
    if name == "choose":
        if not prepared or not browser.fresh(page):
            raise StalePage("Preview a fresh observation before calling Jev.")
        decision = None
        decision = model.choose(page, goal, history)
        return snapshot()
    if name == "execute":
        selected, decision = decision, None
        if not selected or value.get("fingerprint") != page["fingerprint"]:
            raise ValueError("Choose an action for this observation first.")
        if selected["operation"] in {"DONE", "BLOCKED"}:
            raise ValueError("Jev stopped. DONE is a judgment, not independent verification.")
        if selected["confidence"] < 0.8 or (selected.get("target_confidence") is not None and selected["target_confidence"] < 0.8):
            raise ValueError("Review hold: selected operation or target confidence is below 0.80.")
        action = next(a for a in page["actions"] if a["id"] == selected["choice"])
        text = value.get("text")
        if action["kind"] == "fill" and (not isinstance(text, str) or len(text) > 2000):
            raise ValueError("Supply the text yourself; no text model is called.")
        if len(history) >= 20:
            raise ValueError("20-action budget reached. Observe a different tab to start again.")
        browser.act(action, page, text=text)
        history.append({"action": action["label"], "kind": action["kind"], "text": text,
                        "operation": selected["operation"], "target": selected["target"],
                        "model": selected["model"], "page_changed": None})
        prepared = None
        before = page["fingerprint"]
        page = browser.observe(screenshot=False)
        history[-1]["page_changed"] = page["fingerprint"] != before
        return snapshot()
    raise ValueError("Unknown browser command.")


for line in sys.stdin:
    try:
        value = json.loads(line)
        emit({"id": value["id"], "result": command(value)})
    except Exception as error:
        emit({"id": value.get("id"), "error": str(error)[:500]})
