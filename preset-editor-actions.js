const prefix='completion_prompt_manager_popup_entry_form_';
function mount(){
 const buttons=['close','reset','save'].map(id=>document.getElementById(prefix+id));
 if(buttons.some(x=>!x))return;
 const form=buttons[0].closest('form');if(!form||form.querySelector('.tuit-preset-top-actions'))return;
 const row=document.createElement('div');row.className='completion_prompt_manager_popup_entry_form_footer tuit-preset-top-actions';
 for(const [i,id]of ['close','reset','save'].entries()){
  const button=document.createElement('button');button.type='button';button.className=buttons[i].className;button.title=['退出','重置','保存'][i];button.setAttribute('aria-label',button.title);
  button.onclick=()=>{const original=document.getElementById(prefix+id);if(original?.closest('form')===form&&!original.matches('[disabled],[aria-disabled="true"],.disabled'))original.click();};row.append(button);
 }form.prepend(row);
}
mount();let queued=false;new MutationObserver(records=>{if(!queued&&records.some(r=>Array.from(r.addedNodes).some(n=>n.nodeType===1&&(n.id===prefix+'close'||n.querySelector('#'+prefix+'close'))))){queued=true;queueMicrotask(()=>{queued=false;mount();});}}).observe(document.body,{childList:true,subtree:true});
