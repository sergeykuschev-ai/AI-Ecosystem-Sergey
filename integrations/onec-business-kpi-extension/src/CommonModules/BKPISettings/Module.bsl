Function GetSettings() Export
    Selection = InformationRegisters.BusinessKPISettings.Select();
    If Not Selection.Next() Then
        Result = New Structure;
        Result.Insert("ApiUrl", "");
        Result.Insert("ApiKey", "");
        Result.Insert("SourceInstance", "");
        Result.Insert("Mode", "shadow");
        Result.Insert("AllowApply", False);
        Return Result;
    EndIf;

    Result = New Structure;
    Result.Insert("ApiUrl", TrimAll(Selection.ApiUrl));
    Result.Insert("ApiKey", Selection.ApiKey);
    Result.Insert("SourceInstance", TrimAll(Selection.SourceInstance));
    Result.Insert("Mode", Lower(TrimAll(Selection.Mode)));
    Result.Insert("AllowApply", Selection.AllowApply);
    If Result.Mode <> "shadow" And Result.Mode <> "apply" Then
        Result.Mode = "shadow";
    EndIf;
    If Result.Mode = "apply" And Not Result.AllowApply Then
        Result.Mode = "shadow";
    EndIf;
    Return Result;
EndFunction
Procedure EnableApplyInteractively(Confirmation) Export
    If Confirmation <> "ENABLE APPLY" Then
        Raise "Apply mode was not enabled: confirmation phrase does not match.";
    EndIf;
    RecordSet = InformationRegisters.BusinessKPISettings.CreateRecordSet();
    RecordSet.Read();
    If RecordSet.Count() = 0 Then
        Raise "Business KPI settings are not configured.";
    EndIf;
    RecordSet[0].AllowApply = True;
    RecordSet[0].Mode = "apply";
    RecordSet.Write();
EndProcedure

Function SafeSettingsForDiagnostics() Export
    Settings = GetSettings();
    Settings.ApiKey = IIf(IsBlankString(Settings.ApiKey), "not configured", "configured");
    Return Settings;
EndFunction
