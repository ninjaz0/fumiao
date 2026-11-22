export default {
  view(input) {
    return { schema: 1, title: "ComfyUI 节点", blocks: [
      { type: "form", id: "pair", title: "接入工作机", fields: [
        {name:"name", type:"text",label:"实例名称"},
        {name:"models",type:"multiselect",label:"模型",required:true,
         options:[{value:"comfy-image",label:"ComfyUI 图像"}],value:["comfy-image"]}
      ],submit:{action:"pair",label:"生成接入命令"} },
      {type:"list",empty:"暂无工作机",rows:input.nodes.nodes.map(n => ({
        id:n.id,title:n.name,status:n.stage,detail:n.detail,
        actions:[{action:n.control==="active"?"drain":"resume",label:n.control==="active"?"排空":"恢复",target:n.id},
          {action:"remove",label:"移除",target:n.id}]
      }))}
    ] };
  },
};
