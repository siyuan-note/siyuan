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

interface Annotation {
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
            if (key == "zotero"){
                annoData.push(...value)
            }
        })
    }
    debugger;
    return annoData
}

// export async function SaveAnnotations(reader:any) {

//     fetchSyncPost("/api/asset/setFileAnnotation", {
//         path: pdf.appConfig.file.replace(location.origin, "").substr(1) + ".sya",
//         data: JSON.stringify(config),
//     });
// }

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