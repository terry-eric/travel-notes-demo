// Embed keys are necessarily visible in the iframe URL. Restrict this key in
// Google Cloud to Maps Embed API and this site's HTTPS referrer only.
export function handleMapsConfig(request,env){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(!request.headers.get('oai-authenticated-user-id'))return Response.json({error:'請重新登入網站。'},{status:401,headers});
 if(request.method!=='GET')return new Response(null,{status:405,headers});
 return Response.json({embedKey:env.GOOGLE_MAPS_EMBED_KEY||''},{headers});
}
