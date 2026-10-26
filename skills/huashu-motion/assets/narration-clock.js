// Generated project asset. Load after narration-data.js and vendor/om.js.
(function(global){
 'use strict';
 global.NarrationSync={
  attach:function(timeline,options){
   options=options||{};
   var data=options.data||global.NARRATION_SYNC_DATA;
   var container=typeof options.container==='string'?document.querySelector(options.container):options.container;
   if(!data||!container||!global.OM)throw new Error('NarrationSync needs cues, a caption container and OM.');
   var nodes=data.sentences.map(function(cue,index){
    var node=document.createElement('div');
    node.className=options.className||'narration-caption';
    node.setAttribute('data-narration-caption',String(index));
    node.setAttribute('data-om-id','narration-caption-'+index);
    node.textContent=cue.text;node.style.visibility='hidden';node.style.opacity='0';
    return node;
   });
   container.replaceChildren.apply(container,nodes);
   function draw(time){
    // Both shutter samples of a frame must see the same caption state.
    var frame=Math.round(time*data.fps);
    nodes.forEach(function(node,index){
     var cue=data.sentences[index],on=frame>=cue.startFrame&&frame<cue.endFrame;
     node.style.visibility=on?'visible':'hidden';node.style.opacity=on?'1':'0';
    });
   }
   global.OM.clock(timeline,draw,data.duration);
   draw(0);
   return {nodes:nodes,draw:draw};
  }
 };
})(window);
