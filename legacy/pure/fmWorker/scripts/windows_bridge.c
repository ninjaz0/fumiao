#define UNICODE
#define _UNICODE
#include <windows.h>
#include <wchar.h>

int WINAPI wWinMain(HINSTANCE instance,HINSTANCE previous,LPWSTR args,int show){
    wchar_t root[32768],python[32768],command[65536];
    DWORD size=GetModuleFileNameW(NULL,root,32768);
    if(!size||size>=32768)return 2;
    wchar_t *slash=wcsrchr(root,L'\\');if(!slash)return 2;*slash=0;
    _snwprintf(python,32768,L"%ls\\runtime\\python.exe",root);
    if(_snwprintf(command,65536,L"\"%ls\" -X utf8 -u \"%ls\\runtime\\app\\bridge.py\" %ls",python,root,args)<0)return 4;
    STARTUPINFOW startup={0};startup.cb=sizeof(startup);startup.dwFlags=STARTF_USESTDHANDLES;
    startup.hStdInput=GetStdHandle(STD_INPUT_HANDLE);startup.hStdOutput=GetStdHandle(STD_OUTPUT_HANDLE);startup.hStdError=GetStdHandle(STD_ERROR_HANDLE);
    SetHandleInformation(startup.hStdInput,HANDLE_FLAG_INHERIT,HANDLE_FLAG_INHERIT);
    SetHandleInformation(startup.hStdOutput,HANDLE_FLAG_INHERIT,HANDLE_FLAG_INHERIT);
    SetHandleInformation(startup.hStdError,HANDLE_FLAG_INHERIT,HANDLE_FLAG_INHERIT);
    PROCESS_INFORMATION process={0};
    HANDLE job=CreateJobObjectW(NULL,NULL);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits={0};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if(job)SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limits,sizeof(limits));
    if(!CreateProcessW(python,command,NULL,NULL,TRUE,CREATE_NO_WINDOW|CREATE_SUSPENDED,NULL,root,&startup,&process)){if(job)CloseHandle(job);return 3;}
    if(job)AssignProcessToJobObject(job,process.hProcess);
    ResumeThread(process.hThread);CloseHandle(process.hThread);
    WaitForSingleObject(process.hProcess,INFINITE);DWORD code=1;GetExitCodeProcess(process.hProcess,&code);
    CloseHandle(process.hProcess);if(job)CloseHandle(job);return (int)code;
}
