const form = document.getElementById("verifyForm");
const input = document.getElementById("passCode");
const result = document.getElementById("result");
let currentCode = "";
function showResult(data) {
  result.className = "result " + (data.status === "active" ? "active" : data.status === "redeemed" ? "redeemed" : "error");
  currentCode = data.status === "active" ? (data.pass.code || "") : "";
  result.innerHTML = "";
  const heading = document.createElement("strong");
  heading.textContent = data.message;
  result.appendChild(heading);
  if (data.pass) {
    const details = document.createElement("div");
    details.textContent = ` ${data.pass.code} · ${data.pass.name}` + (data.pass.redeemedBy ? ` · ${data.pass.redeemedBy}` : "");
    result.appendChild(details);
  }
  if (currentCode) {
    const button = document.createElement("button");
    button.textContent = "Confirm redemption";
    button.addEventListener("click", redeemCurrent);
    result.appendChild(button);
  }
}
async function verify(code) {
  const response = await fetch("/staff/verify", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({code})});
  const data = await response.json();
  if (!response.ok && !data.status) data.status = "error";
  showResult(data);
}
async function redeemCurrent() {
  if (!currentCode || !confirm("Redeem this pass now? This cannot be undone.")) return;
  const response = await fetch("/staff/redeem", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({code:currentCode})});
  const data = await response.json();
  if (response.ok) {
    showResult({status:"redeemed", message:data.message, pass:{code:currentCode}});
    setTimeout(()=>location.reload(), 1000);
  } else showResult({status:"error", message:data.message});
}
form.addEventListener("submit", async e => {
  e.preventDefault();
  if (input.value.trim()) await verify(input.value.trim());
});
if (window.Html5Qrcode) {
  const scanner = new Html5Qrcode("reader");
  scanner.start({facingMode:"environment"}, {fps:10, qrbox:{width:220,height:220}}, decoded => {
    const match = decoded.match(/\\/pass\\/([a-f0-9]+)/i);
    if (match) { input.value = match[1]; verify(match[1]); scanner.pause(true); }
    else { input.value = decoded; verify(decoded); scanner.pause(true); }
  }).catch(()=>{ document.getElementById("reader").innerHTML = '<p class="tiny">Camera scanning unavailable. Enter the pass code manually.</p>'; });
}