// Keep the shareable offline file complete; online visitors fetch only images
// for the case they actually open. Licence/credit metadata stays in both copies.
export function onlinePage(html, manifest) {
  const pattern=/<script id="campaign-data" type="application\/json">([\s\S]*?)<\/script>/;
  const match=html.match(pattern);if(!match)throw Error('Missing campaign data');
  const records=JSON.parse(match[1]);
  const files=new Map((manifest.images||[]).map(image=>[image.filePage,image.file]));
  for(const campaign of records)for(const image of campaign.images||[]) {
    const file=files.get(image.filePage);
    if(!file||!/^assets\/images\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/.test(file))throw Error('Missing licensed image');
    image.url='/'+file;
  }
  return html.replace(pattern,()=>'<script id="campaign-data" type="application/json">'+JSON.stringify(records).replace(/</g,'\\u003c')+'</script>');
}
