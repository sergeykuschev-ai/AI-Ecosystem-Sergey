// Binding to the exact metadata names in UT 11.5.27.61 is required before
// this extension can be installed or scheduled. Verify document names,
// requisites and payment table sections in Configurator or a metadata export.
Function ReadDay(BusinessDate) Export
    Raise "Business KPI: UT document metadata mapping is not configured.";
EndFunction
