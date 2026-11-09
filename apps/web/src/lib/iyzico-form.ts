/** iyzico'nun döndürdüğü form içeriğini (betikler) sayfaya yükler; kart bilgisi iyzico'nun formunda girilir. */
export function mountIyzicoForm(html: string) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  tpl.content.querySelectorAll("script").forEach((old) => {
    const s = document.createElement("script");
    for (const a of Array.from(old.attributes)) s.setAttribute(a.name, a.value);
    s.text = old.text;
    document.body.appendChild(s);
  });
}
