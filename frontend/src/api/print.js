// Only the chosen element is visible while printing; the class names are used by the print rules in style.css.
export function printElement(element){
 const clean=()=>{element.classList.remove('printable-report');document.body.classList.remove('printing-report');window.removeEventListener('afterprint',clean);};
 element.classList.add('printable-report');document.body.classList.add('printing-report');
 window.addEventListener('afterprint',clean);window.print();
}
