import { Constants } from "../../constants";
import { fetchSyncPost } from "../../util/fetch"

interface OriginAnnotation {
    color: string;
    content: string;
    mode: string;
    pages: {
        index: number;
        positions: [number, number, number, number][];
    }[];
    type: string;
}

export interface Annotation {
    authorName: string;
    color: string;
    comment: string;
    dateCreated: string;
    dateModified?: string; // Assuming this is a string in ISO 8601 format
    id: string;
    pageLabel: string;
    position: {
        pageIndex: number;
        rects: [number, number, number, number][];
    };
    sortIndex: string;
    tags: {
        color?: string; // Optional color field
        name: string;
    }[];
    type: string;
}
interface HighlightAnnotation extends Annotation {
    text: string;
    type: 'highlight';
}

interface ImageAnnotation extends Annotation {
    type: 'image';
    text: string;
    image: string;
}

const annoColor:{[key: string]: string} = {
    'var(--b3-pdf-background1)':"#ffd400",
    'var(--b3-pdf-background2)':"#ff6666",
    'var(--b3-pdf-background3)':"#5fb236",
    'var(--b3-pdf-background4)':"#2ea8e5",
    'var(--b3-pdf-background5)':"#a28ae5",
    'var(--b3-pdf-background6)':"#e56eee",
    'var(--b3-pdf-background7)':"#f19837",
}

export async function getInitAnnotations(path:string) :Promise<any[]>{
    let urlPath = path.replace(location.origin, "").substr(1) + ".sya";
    let originAnnoData:any[] = [];
    let annoData:any[] = [];
    let annoResponse = await fetchSyncPost(
        "/api/asset/getFileAnnotation",
        {
            path: urlPath,
        }
    )
    if (annoResponse.code !== 1){
        originAnnoData = JSON.parse(annoResponse.data.data);
        Object.entries(originAnnoData).forEach(([key, value]) => {
            if (key == "zotero"){
                annoData.push(...value)
            }
            switch(value.mode){
                case "text":
                    annoData.push(translateTextAnno(key,value))
                    break;
                case "rect":
                    annoData.push(translateBorderAnno(key,value))
                    break;
                default:
                    return
            }
        })
    }
    return annoData
}

export async function SaveAnnotations(reader:any,idMap:{[key: string]: string}) {
    let path = reader._data.fileName + ".sya";
     reader._annotationManager._annotations.forEach((anno:Annotation)=>{
        if (anno.id.length < 10 ){
            anno.id = idMap[anno.id]? idMap[anno.id]:Lute.NewNodeID()
        }
    })
    await fetchSyncPost("/api/asset/setFileAnnotation", {
        path: path,
        data: JSON.stringify({
            "zotero":reader._annotationManager._annotations
        }),
    });
}

export function genNodeIDMap(annotations:Annotation[]):{[key: string]: string}{
    let map:{[key: string]: string} = {}
    annotations.forEach((annotation:Annotation)=>{
        if (annotation.id.length < 10 ){
            map[annotation.id] = Lute.NewNodeID()
        }
        else{
            map[annotation.id] = annotation.id
        }
    })
    return map
}

export function getSelectedAnnotations(reader:any){
    let viewer = reader._primaryView
    let type = reader._type
    if (type ==  "pdf"){
        return viewer.getSelectedAnnotations()
    }
    else{
        return viewer._annotations.fliter((x:any)=>viewer._selectedAnnotationIDs.includes(x.id))
    }
}


export function genDataTransferAnnotations(fileName:string){
    let luteEngine = Lute.New();
    return function onSetDataTransferAnnotations(dataTransfer:DataTransfer, annotations:Annotation[], fromText:boolean|undefined){

        let plantText = genClipPlantText(annotations,fileName,fromText)
        dataTransfer.setData('text/plain', plantText || ' ');
        dataTransfer.setData('text/html', luteEngine.Md2BlockDOM(plantText) || ' ');
    }
}

export function saveAnnotationsImage(fileName:string,annotations:Annotation[]){
    annotations.forEach(async (annotation)=>{
        if (!(annotation as ImageAnnotation).image){
            return
        }
        let imageName = `${fileName}-${annotation.id}.png`
        let response = await fetch((annotation as ImageAnnotation).image)
        let blob = await response.blob()
        const formData = new FormData();
        formData.append("file[]", blob, imageName);
        // formData.append("skipIfDuplicated", "true");
        fetchSyncPost(Constants.UPLOAD_ADDRESS,formData)
    })
}

export function genClipPlantText(annotations:Annotation[],fileName:string,fromText:boolean|undefined=false){
    return annotations.map((annotation) => {
        let formatted = '';
        if ((annotation as any).text) {
            let text = (annotation as any).text.trim();
            formatted = fromText ? text : `<<${fileName}/${annotation.id} "${text}">>`;
        }else{
            formatted = `<<${fileName}/${annotation.id} "${fileName}">>`;
        }
        if((annotation as any).image){
            formatted += `\n![](${fileName}-${annotation.id}.png)`
        }
        let comment = annotation.comment?.trim();
        if (comment) {
            if (formatted) {
                formatted += comment.includes('\n') ? '\n' : ' ';
            }
            formatted += comment;
        }
        return formatted;
    }).filter(x => x).join('\n\n')
}

function getSortIndex(pageIndex:number, offset:number, top:number) {
    return [
      pageIndex.toString().slice(0, 5).padStart(5, '0'),
      offset.toString().slice(0, 6).padStart(6, '0'),
      Math.max(Math.floor(top), 0).toString().slice(0, 5).padStart(5, '0')
    ].join('|');
  }

function translateTextAnno(id:string,text:OriginAnnotation):HighlightAnnotation{
    let sortIndex = getSortIndex(text.pages[0].index,0,0)
    let anno:HighlightAnnotation={
        authorName:"",
        color:annoColor[text.color],
        comment:"",
        dateCreated:"",
        id:id,
        pageLabel:"",
        position:{
            pageIndex:text.pages[0].index,
            rects:text.pages[0].positions.map(position=>[position[0],position[3],position[2],position[1]])
        },
        sortIndex,
        tags:[],
        text:text.content,
        type:"highlight"
    }
    return anno
}

function translateBorderAnno(id:string,text:OriginAnnotation):ImageAnnotation{
    let sortIndex = getSortIndex(text.pages[0].index,0,0)
    let anno:ImageAnnotation={
        authorName:"",
        color:annoColor[text.color],
        comment:"",
        dateCreated:"",
        id:id,
        pageLabel:"",
        position:{
            pageIndex:text.pages[0].index,
            rects:text.pages[0].positions.map(position=>[position[0],position[3],position[2],position[1]])
        },
        sortIndex,
        tags:[],
        image:"",
        text:text.content,
        type:"image"
    }
    return anno
}